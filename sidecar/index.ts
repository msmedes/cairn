/**
 * Guide sidecar — slice 2: persisted single-project sessions.
 *
 * Communicates with the Tauri host over LF-delimited JSON on stdio.
 * `init` resumes the most recently opened project under `~/.guide/projects`.
 * If no project exists yet, startup stays empty; the first user prompt creates
 * a project from that message and persists the pi session inside it.
 */

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { loadRepoLocalEnv } from "./env";
import { createGuideTools } from "./guide-tools";
import {
  type HydrateEvent,
  translateSessionEntriesToHydrateEvent,
} from "./hydrate";
import { emitHydrateAndMaybeResumeRecap } from "./init-recap";
import { type Project, ProjectStore } from "./project-store";

type InMsg =
  | { type: "init"; personaPath?: string }
  | { type: "prompt"; text: string };

type OutMsg =
  | HydrateEvent
  | {
      type: "active_project";
      project: Pick<Project, "id" | "name" | "path" | "displayName">;
    }
  | { type: "ready" }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | { type: "creating_started"; target: "brief"; message: string }
  | { type: "agent_end" }
  | { type: "error"; message: string };

type DevLogMsg =
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean }
  | { type: "assistant_error"; message: string };

let session: AgentSession | null = null;
let sessionManager: SessionManager | null = null;
let unsubscribeSession: (() => void) | null = null;
let projectStore = new ProjectStore();
let activeProject: Project | null = null;
let activePersonaPath: string | null = null;
let stdinBuffer = "";
let inputQueue = Promise.resolve();
let streamedAssistantText = false;
let suppressAssistantError = false;
const startupCwd = process.cwd();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadRepoLocalEnv();

function getSessionDir(project: Project) {
  return join(project.path, "sessions");
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

function emitDevLog(msg: DevLogMsg) {
  process.stderr.write(`${JSON.stringify(msg)}\n`);
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
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

          if (!streamedAssistantText) {
            const fullText = extractAssistantText(event.message.content);
            if (fullText) {
              emit({ type: "text_delta", delta: fullText });
            }
          }
          streamedAssistantText = false;
          emit({ type: "text_done" });
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

function retargetActiveRuntimeAfterRename(
  previousProject: Project,
  nextProject: Project,
) {
  process.chdir(nextProject.path);

  if (sessionManager) {
    const mutableManager = sessionManager as unknown as {
      cwd: string;
      sessionDir: string;
      sessionFile?: string;
      getSessionFile?: () => string | undefined;
    };
    const previousSessionDir = getSessionDir(previousProject);
    const currentSessionFile = mutableManager.getSessionFile?.();
    mutableManager.cwd = nextProject.path;
    mutableManager.sessionDir = getSessionDir(nextProject);
    if (currentSessionFile?.startsWith(previousSessionDir)) {
      mutableManager.sessionFile = join(
        mutableManager.sessionDir,
        basename(currentSessionFile),
      );
    }
  }

  if (session) {
    const mutableSession = session as unknown as {
      _cwd: string;
      getActiveToolNames: () => string[];
      _buildRuntime: (options: {
        activeToolNames: string[];
        includeAllExtensionTools: boolean;
      }) => void;
    };
    mutableSession._cwd = nextProject.path;
    mutableSession._buildRuntime({
      activeToolNames: mutableSession.getActiveToolNames(),
      includeAllExtensionTools: true,
    });
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
  mkdirSync(sessionDir, { recursive: true });
  process.chdir(cwd);
  const personaContent = readFileSync(personaPath, "utf8");

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    additionalSkillPaths: [resolve(repoRoot, "prompts/skills")],
    systemPromptOverride: () => personaContent,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const nextSessionManager = hasExistingSession(sessionDir)
    ? SessionManager.continueRecent(cwd, sessionDir)
    : SessionManager.create(cwd, sessionDir);

  const { session: nextSession } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    resourceLoader,
    sessionManager: nextSessionManager,
    customTools: createGuideTools({
      getActiveProject: () => activeProject,
      renameProject: (id, displayName) => projectStore.rename(id, displayName),
      onRenameSuccess: (previousProject, nextProject) => {
        activeProject = nextProject;
        retargetActiveRuntimeAfterRename(previousProject, nextProject);
      },
      onProjectUpdate: emitActiveProject,
      onCreatingStart: (target, message) => {
        emit({ type: "creating_started", target, message });
      },
    }),
  });

  session = nextSession;
  sessionManager = nextSessionManager;
  wireSessionEvents(nextSession);

  if (options.emitHydrate) {
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
}

async function handleInit(msg: Extract<InMsg, { type: "init" }>) {
  disposeSession();
  activeProject = null;

  const { personaPath } = msg;
  const resolvedPersonaPath = resolve(
    startupCwd,
    personaPath ?? "prompts/persona.md",
  );
  readFileSync(resolvedPersonaPath, "utf8");
  activePersonaPath = resolvedPersonaPath;

  projectStore = new ProjectStore();
  const recentProject = projectStore.findMostRecent();
  if (recentProject) {
    const touchedProject = projectStore.touch(recentProject.id);
    await openProject(touchedProject, resolvedPersonaPath, {
      emitHydrate: true,
    });
  } else {
    emit({ type: "hydrate", messages: [] });
  }
  emit({ type: "ready" });
}

async function handlePrompt(text: string) {
  if (!activePersonaPath) {
    throw new Error("sidecar not initialized");
  }
  if (!activeProject) {
    const project = projectStore.create(text);
    await openProject(project, activePersonaPath, { emitHydrate: false });
  } else {
    activeProject = projectStore.touch(activeProject.id);
    emitActiveProject(activeProject);
  }
  if (!session) {
    throw new Error("session not initialized");
  }
  await session.prompt(text);
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
      await handlePrompt(msg.text);
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
