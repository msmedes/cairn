/**
 * Cairn sidecar — slice 2: persisted single-project sessions.
 *
 * Communicates with the Tauri host over LF-delimited JSON on stdio.
 * `init` resumes the most recently opened project under `~/.cairn/projects`.
 * If no project exists yet, startup stays empty; the first user prompt creates
 * a project from that message and persists the pi session inside it.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Context,
  fauxAssistantMessage,
  fauxToolCall,
  type ImageContent,
  type Model,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { loadCairnSettingsEnv, loadRepoLocalEnv } from "./config/env";
import { authenticateConfiguredMcpServer } from "./integrations/mcp-auth";
import { CAIRN_EXTENSION_FACTORIES } from "./integrations/pi-extensions";
import { CairnDir } from "./project/cairn-dir";
import { migrateLegacyProject } from "./project/legacy-migrator";
import { findProjectRoot } from "./project/project-locator";
import { getProjectState, type ProjectPhase } from "./project/project-phase";
import { type Project, ProjectStore } from "./project/project-store";
import {
  type RecentProjectEntry,
  RecentsRegistry,
} from "./project/recents-registry";
import {
  type HydrateEvent,
  translateSessionEntriesToDevLogMessages,
  translateSessionEntriesToHydrateEvent,
} from "./protocol/hydrate";
import { emitHydrateAndMaybeResumeRecap } from "./protocol/init-recap";
import { recoverDanglingToolCallInDir } from "./recovery/dangling-tool-recovery";
import type { SpawnSubagentResult } from "./subagents/spawn-subagent";
import { createCairnTools } from "./tools/cairn-tools";
import { disambiguate, slugify, withDatePrefix } from "./utils/slug";

type InMsg =
  | {
      type: "init";
      personaPath?: string;
      skillsPath?: string;
      skipAutoOpen?: boolean;
    }
  | { type: "prompt"; text: string; images?: WirePromptImage[] }
  | { type: "new_project" }
  | { type: "open_project"; path: string; locateProjectRoot?: boolean }
  | { type: "list_recents" }
  | { type: "reload_mcp_config" }
  | { type: "authenticate_mcp_server"; server: string }
  | { type: "set_api_key"; provider: "anthropic"; apiKey: string };

type OutMsg =
  | HydrateEvent
  | {
      type: "active_project";
      project: Pick<Project, "id" | "name" | "path" | "displayName">;
    }
  | { type: "ready" }
  | { type: "recents"; entries: RecentProjectEntry[] }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | {
      type: "creating_started";
      target: "brief" | "prd" | "issues" | "plan" | "tasks";
      message: string;
    }
  | {
      type: "mcp_auth_status";
      server: string;
      status: "started" | "authenticated" | "failed";
      message: string;
    }
  | { type: "agent_end" }
  | { type: "error"; message: string; recoverable?: boolean };

type WirePromptImage = {
  data: string;
  mimeType: string;
};

type DevLogMsg =
  | {
      type: "agent_threads";
      threads: AgentThread[];
    }
  | {
      type: "session_location";
      sessionFile: string;
      sessionDir: string;
      projectPath: string;
    }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean }
  | { type: "assistant_error"; message: string }
  | { type: "session_event"; event: AgentSessionEvent | unknown }
  | {
      type: "project_state";
      brief: boolean;
      prds: string[];
      issues: string[];
      phase: ProjectPhase;
    };

type SessionEntryLike = {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type SpawnCall = {
  parentAgentId: string;
  timestampMs: number;
  label: string;
};

type AgentThread = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "cairn" | "subagent";
  sessionFile?: string;
};

let session: AgentSession | null = null;
let sessionManager: SessionManager | null = null;
let unsubscribeSession: (() => void) | null = null;
let projectStore = new ProjectStore();
let recentsRegistry = new RecentsRegistry();
let activeProject: Project | null = null;
let activePersonaPath: string | null = null;
let activeSkillsPath: string | null = null;
let stdinBuffer = "";
let inputQueue = Promise.resolve();
let streamedAssistantText = false;
let suppressAssistantError = false;
const startupCwd = process.cwd();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadRepoLocalEnv();
loadCairnSettingsEnv();

function getSessionDir(project: Project) {
  return CairnDir.sessionsDir(project.path);
}

function hasExistingSession(sessionDir: string) {
  try {
    return readdirSync(sessionDir).some((name) => name.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

function readSessionEntriesFromFile(sessionFile: string) {
  return readFileSync(sessionFile, "utf8")
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        return [JSON.parse(trimmed)];
      } catch {
        return [];
      }
    });
}

function timestampMs(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractSpawnCallLabel(content: unknown) {
  if (!Array.isArray(content)) return null;

  for (const part of content) {
    if (!isRecord(part) || part.type !== "toolCall") continue;
    if (part.name !== "spawn_subagent") continue;
    const args = isRecord(part.arguments) ? part.arguments : {};
    const skillName =
      typeof args.skill_name === "string" ? args.skill_name : "subagent";
    const handoffArgs = isRecord(args.args) ? args.args : {};
    const issuePath =
      typeof handoffArgs.issue_path === "string"
        ? handoffArgs.issue_path.split("/").pop()
        : null;
    return issuePath ? `${skillName}: ${issuePath}` : skillName;
  }

  return null;
}

function collectSpawnCalls(agentId: string, entries: SessionEntryLike[]) {
  return entries.flatMap((entry): SpawnCall[] => {
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      return [];
    }
    const label = extractSpawnCallLabel(entry.message.content);
    if (!label) return [];
    return [
      {
        parentAgentId: agentId,
        timestampMs: timestampMs(entry.timestamp),
        label,
      },
    ];
  });
}

function listSubagentSessionFiles(project: Project) {
  const subagentDir = join(getSessionDir(project), "subagents");
  try {
    return readdirSync(subagentDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => join(subagentDir, name));
  } catch {
    return [];
  }
}

function agentIdForSessionFile(sessionFile: string) {
  return `subagent:${sessionFile}`;
}

function buildAgentThreads(
  parentEntries: SessionEntryLike[],
  subagentSessions: Array<{ sessionFile: string; entries: SessionEntryLike[] }>,
  parentSessionFile?: string,
) {
  const spawnCalls = [
    ...collectSpawnCalls("cairn", parentEntries),
    ...subagentSessions.flatMap((session) =>
      collectSpawnCalls(
        agentIdForSessionFile(session.sessionFile),
        session.entries,
      ),
    ),
  ].sort((a, b) => a.timestampMs - b.timestampMs);

  const threads: AgentThread[] = [
    {
      id: "cairn",
      parentId: null,
      label: "Cairn",
      kind: "cairn",
      sessionFile: parentSessionFile,
    },
  ];

  for (const session of subagentSessions) {
    const startedAt = timestampMs(session.entries[0]?.timestamp);
    const spawnCall = spawnCalls
      .filter((call) => call.timestampMs <= startedAt)
      .at(-1);
    threads.push({
      id: agentIdForSessionFile(session.sessionFile),
      parentId: spawnCall?.parentAgentId ?? "cairn",
      label: spawnCall?.label ?? "subagent",
      kind: "subagent",
      sessionFile: session.sessionFile,
    });
  }

  return threads;
}

function emitPersistedSessionDevLogs(
  manager: Pick<SessionManager, "getEntries" | "getSessionFile">,
  project: Project,
) {
  const parentEntries = manager.getEntries() as SessionEntryLike[];
  const subagentSessions = listSubagentSessionFiles(project).map(
    (sessionFile) => ({
      sessionFile,
      entries: readSessionEntriesFromFile(sessionFile) as SessionEntryLike[],
    }),
  );
  const threads = buildAgentThreads(
    parentEntries,
    subagentSessions,
    manager.getSessionFile(),
  );
  const parentByAgentId = new Map(
    threads.map((thread) => [thread.id, thread.parentId]),
  );

  emitDevLog({ type: "agent_threads", threads });

  for (const message of translateSessionEntriesToDevLogMessages(parentEntries, {
    kind: "parent",
    agentId: "cairn",
  })) {
    emitDevLog(message);
  }

  for (const { sessionFile, entries } of subagentSessions) {
    const agentId = agentIdForSessionFile(sessionFile);
    for (const message of translateSessionEntriesToDevLogMessages(entries, {
      kind: "subagent",
      agentId,
      parentAgentId: parentByAgentId.get(agentId) ?? undefined,
      sessionFile,
    })) {
      emitDevLog(message);
    }
  }
}

function emitSessionLocation(manager: SessionManager, project: Project) {
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) return;
  emitDevLog({
    type: "session_location",
    sessionFile,
    sessionDir: getSessionDir(project),
    projectPath: project.path,
  });
}

function emit(msg: OutMsg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function emitRecents() {
  emit({ type: "recents", entries: recentsRegistry.list() });
}

function emitDevLog(msg: DevLogMsg) {
  process.stderr.write(`${JSON.stringify(msg)}\n`);
}

function emitProjectState() {
  if (!activeProject) return;
  const state = getProjectState(activeProject.path);

  emitDevLog({
    type: "project_state",
    ...state,
  });
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getFakeSpawnSubagentResultFromEnv():
  | ((input: {
      projectRoot: string;
      skillName: string;
      args: Record<string, unknown>;
      responseSchema: string;
      signal?: AbortSignal;
    }) => Promise<SpawnSubagentResult>)
  | undefined {
  const raw = process.env.CAIRN_FAKE_SPAWN_SUBAGENT_RESULT;
  if (!raw) return undefined;

  return async () => JSON.parse(raw) as SpawnSubagentResult;
}

function findLastToolResultText(context: Context) {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message.role !== "toolResult") continue;
    return message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
  }
  return "";
}

function getFakeProtocolSpawnModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_SPAWN_SUBAGENT !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "spawn_subagent",
        {
          skill_name: "write-prd",
          args: { slice: "first" },
          response_schema: "task_outcome",
        },
        { id: "tool-spawn-subagent" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `spawn_subagent result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdateTaskStatusModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_TASK_STATUS !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_task_status",
        {
          task_slug: "preview-it-as-a-learner",
          status: "done",
        },
        { id: "tool-update-task-status" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_task_status result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolCreateTasksModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_CREATE_TASKS !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "create_tasks_artifact",
        {
          issues: [
            {
              issue_path: "issues/01-create-the-first-quiz-draft.md",
              title: "Create the first quiz draft",
            },
            {
              issue_path: "issues/02-preview-it-as-a-learner.md",
              title: "Preview it as a learner",
            },
          ],
        },
        { id: "tool-create-tasks" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `create_tasks_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolCreateBriefModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_CREATE_BRIEF !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "create_brief_artifact",
        {
          title: "Video Quiz Helper",
          summary:
            "A small tool for turning training videos into simple quizzes.",
          audience: "Team leads who need lightweight training checks.",
          success:
            "A lead can paste in a video, add questions, and share the quiz.",
          sections: [
            {
              heading: "What it does first",
              body: "It helps a lead create one quiz from one training video.",
            },
          ],
        },
        { id: "tool-create-brief" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `create_brief_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdateBriefModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_BRIEF !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_brief_artifact",
        {
          title: "Focused Video Quiz Helper",
          summary:
            "A focused tool for turning one training video into a simple quiz.",
          audience: "Team leads who need lightweight training checks.",
          success:
            "A lead can paste in one video, add questions, and share the quiz.",
          sections: [
            {
              heading: "What it does first",
              body: "It helps a lead create one focused quiz from one training video.",
            },
          ],
          reason: "User narrowed the first version.",
        },
        { id: "tool-update-brief" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_brief_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolCreatePlanModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_CREATE_PLAN !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "create_plan_artifact",
        {
          title: "First playable quiz",
          summary: "Start with one video and one shareable quiz.",
          from_brief:
            "The brief asks for lightweight checks, so this proves one quiz end to end.",
          outcomes: ["You'll be able to paste in one training video."],
          pieces: [
            "Create the first quiz draft",
            "Preview it as a learner",
            "Share the finished quiz",
          ],
          not_yet: ["Team analytics", "Question banks"],
        },
        { id: "tool-create-plan" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `create_plan_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdatePlanModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_PLAN !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_plan_artifact",
        {
          title: "Focused first quiz",
          summary: "Start with one video and a focused learner preview.",
          from_brief:
            "The brief asks for lightweight checks, so this proves the first quiz flow.",
          outcomes: ["You'll be able to paste in one training video."],
          pieces: [
            "Create the first quiz draft",
            "Preview it as a learner",
            "Share the finished quiz",
          ],
          not_yet: ["Team analytics", "Question banks"],
          reason: "User changed the first slice.",
        },
        { id: "tool-update-plan" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_plan_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdateProjectContextModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_PROJECT_CONTEXT !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_project_context",
        {
          terms: [
            {
              name: "Instructor",
              definition: "The person creating lightweight checks for a team.",
            },
          ],
          constraints: ["Keep setup non-technical and app-owned."],
          decisions: ["Start with one video and one quiz."],
          open_questions: ["Who reviews generated questions?"],
        },
        { id: "tool-update-project-context" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_project_context result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolSetProjectNameModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_SET_PROJECT_NAME !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "set_project_name",
        { name: "Renamed Project" },
        { id: "tool-set-project-name" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `set_project_name result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolTextModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  const text = process.env.CAIRN_FAKE_PROTOCOL_TEXT_RESPONSE;
  if (!text) return undefined;

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([fauxAssistantMessage(text)]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  return (
    getFakeProtocolSpawnModel() ??
    getFakeProtocolUpdateTaskStatusModel() ??
    getFakeProtocolCreateTasksModel() ??
    getFakeProtocolCreateBriefModel() ??
    getFakeProtocolUpdateBriefModel() ??
    getFakeProtocolCreatePlanModel() ??
    getFakeProtocolUpdatePlanModel() ??
    getFakeProtocolUpdateProjectContextModel() ??
    getFakeProtocolSetProjectNameModel() ??
    getFakeProtocolTextModel()
  );
}

function createAuthStorageFromRuntimeEnv() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return undefined;

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("anthropic", key);
  return authStorage;
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }
      return [];
    })
    .join("");
}

function getAssistantErrorMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  if (
    !("errorMessage" in message) ||
    typeof message.errorMessage !== "string"
  ) {
    return null;
  }
  return message.errorMessage;
}

function disposeSession() {
  unsubscribeSession?.();
  unsubscribeSession = null;
  session?.dispose();
  session = null;
  sessionManager = null;
  streamedAssistantText = false;
  suppressAssistantError = false;
}

function wireSessionEvents(nextSession: AgentSession) {
  unsubscribeSession = nextSession.subscribe((event: AgentSessionEvent) => {
    emitDevLog({ type: "session_event", event });
    switch (event.type) {
      case "message_update":
        switch (event.assistantMessageEvent.type) {
          case "text_delta":
            streamedAssistantText = true;
            emit({
              type: "text_delta",
              delta: event.assistantMessageEvent.delta,
            });
            break;
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          const assistantError = getAssistantErrorMessage(event.message);
          if (assistantError) {
            streamedAssistantText = false;
            emitDevLog({ type: "assistant_error", message: assistantError });
            if (suppressAssistantError) {
              if (sessionManager) {
                emit(
                  translateSessionEntriesToHydrateEvent(
                    sessionManager.getEntries(),
                  ),
                );
              }
              break;
            }
            emit({
              type: "error",
              message: "I hit a snag while working on that.",
            });
            break;
          }

          let emittedAssistantText = streamedAssistantText;
          if (!streamedAssistantText) {
            const fullText = extractAssistantText(event.message.content);
            if (fullText) {
              emit({ type: "text_delta", delta: fullText });
              emittedAssistantText = true;
            }
          }
          streamedAssistantText = false;
          if (emittedAssistantText) {
            emit({ type: "text_done" });
          }
        }
        break;
      case "tool_execution_start":
        emitDevLog({ type: "tool_start", name: event.toolName });
        break;
      case "tool_execution_end":
        emitDevLog({
          type: "tool_end",
          name: event.toolName,
          ok: !event.isError,
        });
        break;
      case "agent_end":
        suppressAssistantError = false;
        emit({ type: "agent_end" });
        emitProjectState();
        break;
    }
  });
}

function emitActiveProject(project: Project) {
  emit({
    type: "active_project",
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      displayName: project.displayName,
    },
  });
}

function transientProjectForPath(projectPath: string): Project {
  const displayName = basename(projectPath) || projectPath;
  const now = new Date().toISOString();
  return {
    id: `path-${slugify(displayName)}`,
    name: displayName,
    displayName,
    path: projectPath,
    createdAt: now,
    lastOpenedAt: now,
  };
}

function defaultProjectsRoot() {
  return join(homedir(), ".cairn", "projects");
}

function nextLegacyProjectPath(firstMessage: string, now: Date = new Date()) {
  const projectsRoot = defaultProjectsRoot();
  mkdirSync(projectsRoot, { recursive: true });
  const baseSlug = withDatePrefix(slugify(firstMessage), now);
  const existingProjectIds = readdirSync(projectsRoot).flatMap((name) => {
    try {
      return statSync(join(projectsRoot, name)).isDirectory() ? [name] : [];
    } catch {
      return [];
    }
  });
  return join(projectsRoot, disambiguate(baseSlug, existingProjectIds));
}

function isOpenableRecent(entry: RecentProjectEntry) {
  try {
    if (!statSync(entry.path).isDirectory()) return false;
  } catch {
    return false;
  }
  return (
    existsSync(CairnDir.root(entry.path)) ||
    existsSync(join(entry.path, "project.json"))
  );
}

function assertDirectoryPath(projectPath: string) {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(projectPath);
  } catch {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
}

async function openProject(
  project: Project,
  personaPath: string,
  options: { emitHydrate: boolean },
) {
  disposeSession();
  activeProject = project;
  emitActiveProject(project);

  const cwd = project.path;
  const sessionDir = getSessionDir(project);
  mkdirSync(cwd, { recursive: true });
  CairnDir.ensure(cwd);
  mkdirSync(sessionDir, { recursive: true });
  process.chdir(cwd);
  const personaContent = readFileSync(personaPath, "utf8");

  const skillsPath = activeSkillsPath ?? resolve(repoRoot, "prompts/skills");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    additionalSkillPaths: [skillsPath],
    extensionFactories: CAIRN_EXTENSION_FACTORIES,
    systemPromptOverride: () => personaContent,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const sessionExists = hasExistingSession(sessionDir);
  if (sessionExists) {
    recoverDanglingToolCallInDir(sessionDir);
  }
  const nextSessionManager = sessionExists
    ? SessionManager.continueRecent(cwd, sessionDir)
    : SessionManager.create(cwd, sessionDir);

  const fakeProtocol = getFakeProtocolModel();
  const runtimeAuthStorage = createAuthStorageFromRuntimeEnv();
  const { session: nextSession } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    resourceLoader,
    sessionManager: nextSessionManager,
    model: fakeProtocol?.model,
    authStorage: fakeProtocol?.authStorage ?? runtimeAuthStorage,
    customTools: createCairnTools({
      getActiveProject: () => activeProject,
      renameProject: (id, displayName) => projectStore.rename(id, displayName),
      onRenameSuccess: (_previousProject, nextProject) => {
        activeProject = nextProject;
        recentsRegistry.add(nextProject.path, nextProject.displayName);
        emitRecents();
      },
      onProjectUpdate: emitActiveProject,
      onCreatingStart: (target, message) => {
        emit({ type: "creating_started", target, message });
      },
      getLoadedSkills: () => resourceLoader.getSkills().skills,
      spawnSubagent: getFakeSpawnSubagentResultFromEnv(),
    }),
  });
  await nextSession.bindExtensions({
    onError: (err) => {
      console.error(`Extension error (${err.extensionPath}): ${err.error}`);
    },
  });

  session = nextSession;
  sessionManager = nextSessionManager;
  wireSessionEvents(nextSession);
  emitSessionLocation(nextSessionManager, project);

  if (options.emitHydrate) {
    emitPersistedSessionDevLogs(nextSessionManager, project);

    suppressAssistantError = true;
    await emitHydrateAndMaybeResumeRecap(nextSession, nextSessionManager, {
      emitHydrate: (event) => emit(event),
      onRecapError: (err) => {
        emitDevLog({
          type: "assistant_error",
          message: `resume recap failed: ${formatError(err)}`,
        });
      },
    });
    suppressAssistantError = false;
  }

  emitProjectState();
}

async function handleInit(msg: Extract<InMsg, { type: "init" }>) {
  disposeSession();
  activeProject = null;

  const { personaPath, skillsPath } = msg;
  const resolvedPersonaPath = resolve(
    startupCwd,
    personaPath ?? "prompts/persona.md",
  );
  readFileSync(resolvedPersonaPath, "utf8");
  activePersonaPath = resolvedPersonaPath;
  activeSkillsPath = skillsPath ? resolve(startupCwd, skillsPath) : null;

  projectStore = new ProjectStore();
  recentsRegistry = new RecentsRegistry();
  recentsRegistry.bootstrapFromLegacyProjects();

  let openedRecent = false;
  if (!msg.skipAutoOpen) {
    for (const recent of recentsRegistry.list()) {
      if (!isOpenableRecent(recent)) {
        recentsRegistry.remove(recent.path);
        continue;
      }
      await openProjectPath(recent.path, { emitHydrate: true });
      openedRecent = true;
      break;
    }
  }
  if (!openedRecent) emit({ type: "hydrate", messages: [] });
  emitRecents();
  emit({ type: "ready" });
}

async function openProjectPath(
  rawPath: string,
  options: { emitHydrate: boolean; locateProjectRoot?: boolean },
) {
  if (!activePersonaPath) {
    throw new Error("sidecar not initialized");
  }
  const resolvedPath = resolve(rawPath);
  const projectPath = options.locateProjectRoot
    ? (findProjectRoot(resolvedPath) ?? resolvedPath)
    : resolvedPath;
  try {
    assertDirectoryPath(projectPath);
  } catch (err) {
    recentsRegistry.remove(projectPath);
    emitRecents();
    throw err;
  }

  migrateLegacyProject(projectPath);
  CairnDir.ensure(projectPath);
  const project =
    projectStore.read(projectPath) ?? transientProjectForPath(projectPath);
  recentsRegistry.add(project.path, project.displayName);
  emitRecents();
  await openProject(project, activePersonaPath, options);
}

async function handlePrompt(text: string, images: WirePromptImage[] = []) {
  if (!activePersonaPath) {
    throw new Error("sidecar not initialized");
  }
  if (!activeProject) {
    const project = projectStore.create(nextLegacyProjectPath(text), text);
    await openProject(project, activePersonaPath, { emitHydrate: false });
    recentsRegistry.add(project.path, project.displayName);
    emitRecents();
  } else {
    activeProject =
      projectStore.read(activeProject.path) === null
        ? projectStore.create(activeProject.path, text)
        : projectStore.touch(activeProject.path);
    recentsRegistry.add(activeProject.path, activeProject.displayName);
    emitRecents();
    emitActiveProject(activeProject);
  }
  if (!session) {
    throw new Error("session not initialized");
  }
  if (images.length === 0) {
    await session.prompt(text);
    return;
  }

  const promptImages: ImageContent[] = images.map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mimeType,
  }));
  await session.prompt(text, { images: promptImages });
}

async function handleNewProject() {
  disposeSession();
  activeProject = null;
  process.chdir(startupCwd);
  emit({ type: "hydrate", messages: [] });
  emitProjectState();
}

async function handleOpenProject(
  msg: Extract<InMsg, { type: "open_project" }>,
) {
  try {
    await openProjectPath(msg.path, {
      emitHydrate: true,
      locateProjectRoot: msg.locateProjectRoot,
    });
  } catch (err) {
    emit({ type: "error", message: formatError(err), recoverable: true });
  }
}

async function handleSetApiKey(msg: Extract<InMsg, { type: "set_api_key" }>) {
  const apiKey = msg.apiKey.trim();
  if (!apiKey) {
    throw new Error("API key cannot be empty");
  }

  process.env.ANTHROPIC_API_KEY = apiKey;

  if (activeProject && activePersonaPath) {
    const project = activeProject;
    await openProject(project, activePersonaPath, { emitHydrate: true });
  }

  emit({ type: "ready" });
}

async function handleReloadMcpConfig() {
  if (activeProject && activePersonaPath) {
    const project = activeProject;
    await openProject(project, activePersonaPath, { emitHydrate: true });
  }

  emit({ type: "ready" });
}

async function handleAuthenticateMcpServer(
  msg: Extract<InMsg, { type: "authenticate_mcp_server" }>,
) {
  emit({
    type: "mcp_auth_status",
    server: msg.server,
    status: "started",
    message: `Opening ${msg.server} OAuth in your browser...`,
  });

  try {
    const status = await authenticateConfiguredMcpServer(msg.server);
    if (status !== "authenticated") {
      emit({
        type: "mcp_auth_status",
        server: msg.server,
        status: "failed",
        message: `OAuth did not complete for ${msg.server}.`,
      });
      emit({ type: "ready" });
      return;
    }

    emit({
      type: "mcp_auth_status",
      server: msg.server,
      status: "authenticated",
      message: `${msg.server} is authenticated.`,
    });
    if (activeProject && activePersonaPath) {
      const project = activeProject;
      await openProject(project, activePersonaPath, { emitHydrate: true });
    } else {
      emit({ type: "ready" });
    }
  } catch (err) {
    emit({
      type: "mcp_auth_status",
      server: msg.server,
      status: "failed",
      message: formatError(err),
    });
    emit({ type: "ready" });
  }
}

async function handleLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg: InMsg;
  try {
    msg = JSON.parse(trimmed) as InMsg;
  } catch (err) {
    emit({ type: "error", message: `bad input: ${formatError(err)}` });
    return;
  }

  switch (msg.type) {
    case "init":
      await handleInit(msg);
      break;
    case "prompt":
      await handlePrompt(msg.text, msg.images);
      break;
    case "new_project":
      await handleNewProject();
      break;
    case "open_project":
      await handleOpenProject(msg);
      break;
    case "list_recents":
      emitRecents();
      break;
    case "reload_mcp_config":
      await handleReloadMcpConfig();
      break;
    case "authenticate_mcp_server":
      await handleAuthenticateMcpServer(msg);
      break;
    case "set_api_key":
      await handleSetApiKey(msg);
      break;
  }
}

function queueLine(line: string) {
  inputQueue = inputQueue
    .then(() => handleLine(line))
    .catch((err) => {
      emit({ type: "error", message: formatError(err) });
    });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  stdinBuffer += chunk;

  while (true) {
    const newlineIndex = stdinBuffer.indexOf("\n");
    if (newlineIndex === -1) break;

    const line = stdinBuffer.slice(0, newlineIndex).replace(/\r$/, "");
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    queueLine(line);
  }
});

process.stdin.on("end", async () => {
  try {
    await inputQueue;
  } finally {
    disposeSession();
    process.exit(0);
  }
});

process.stdin.resume();
