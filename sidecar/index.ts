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
import type { ImageContent } from "@mariozechner/pi-ai";
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
  applyAssistantTextStreamEvent,
  createAssistantTextStreamState,
  resetAssistantTextStream,
} from "./protocol/assistant-text-stream";
import {
  type HydrateEvent,
  translateSessionEntriesToHydrateEvent,
} from "./protocol/hydrate";
import { emitHydrateAndMaybeResumeRecap } from "./protocol/init-recap";
import { askUserQuestionPendingRegistry } from "./questions/ask-user-question-pending";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionBundle,
  AskUserQuestionResult,
} from "./questions/ask-user-question-schema";
import { recoverDanglingToolCallInDir } from "./recovery/dangling-tool-recovery";
import {
  type AgentThread,
  emitPersistedSessionDevLogs,
  emitSessionLocation,
  type SessionLocationDevLog,
} from "./runtime/agent-threads";
import {
  getFakeProtocolModel,
  getFakeSpawnSubagentResultFromEnv,
} from "./runtime/faux-protocol-models";
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
  | {
      type: "answer_question";
      toolCallId: string;
      cancelled: boolean;
      answers: AskUserQuestionAnswer[];
    }
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
      type: "ask_user_question";
      toolCallId: string;
      questions: AskUserQuestionBundle;
    }
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
  | SessionLocationDevLog
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
const assistantTextStreamState = createAssistantTextStreamState();
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

function createAuthStorageFromRuntimeEnv() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return undefined;

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("anthropic", key);
  return authStorage;
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
  askUserQuestionPendingRegistry.cancelAllPending("session closed");
  unsubscribeSession?.();
  unsubscribeSession = null;
  session?.dispose();
  session = null;
  sessionManager = null;
  resetAssistantTextStream(assistantTextStreamState);
  suppressAssistantError = false;
}

function wireSessionEvents(nextSession: AgentSession) {
  unsubscribeSession = nextSession.subscribe((event: AgentSessionEvent) => {
    emitDevLog({ type: "session_event", event });
    switch (event.type) {
      case "message_start":
      case "message_update":
        for (const msg of applyAssistantTextStreamEvent(
          assistantTextStreamState,
          event,
        )) {
          emit(msg);
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          const assistantError = getAssistantErrorMessage(event.message);
          if (assistantError) {
            resetAssistantTextStream(assistantTextStreamState);
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

          for (const msg of applyAssistantTextStreamEvent(
            assistantTextStreamState,
            event,
          )) {
            emit(msg);
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
      askUserQuestion: ({ toolCallId, questions }) => {
        const pending =
          askUserQuestionPendingRegistry.registerPending(toolCallId);
        emit({ type: "ask_user_question", toolCallId, questions });
        return pending;
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
  emitSessionLocation(nextSessionManager, project, emitDevLog);

  if (options.emitHydrate) {
    emitPersistedSessionDevLogs(nextSessionManager, project, emitDevLog);

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

function handleAnswerQuestion(
  msg: Extract<InMsg, { type: "answer_question" }>,
) {
  const result: AskUserQuestionResult = msg.cancelled
    ? { cancelled: true, answers: [] }
    : { cancelled: false, answers: msg.answers };

  const resolved = askUserQuestionPendingRegistry.resolvePending(
    msg.toolCallId,
    result,
  );
  if (!resolved) {
    emit({
      type: "error",
      message: `No pending question exists for ${msg.toolCallId}.`,
      recoverable: true,
    });
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
    case "answer_question":
      handleAnswerQuestion(msg);
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

function tryHandleOutOfBandLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("type" in parsed) ||
    parsed.type !== "answer_question"
  ) {
    return false;
  }

  handleAnswerQuestion(parsed as Extract<InMsg, { type: "answer_question" }>);
  return true;
}

function queueLine(line: string) {
  if (tryHandleOutOfBandLine(line)) return;

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