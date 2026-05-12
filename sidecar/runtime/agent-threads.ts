import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { CairnDir } from "../project/cairn-dir";
import type { Project } from "../project/project-store";
import {
  type HydrateDevLogMessage,
  translateSessionEntriesToDevLogMessages,
} from "../protocol/hydrate";

export type SessionLocationDevLog = {
  type: "session_location";
  sessionFile: string;
  sessionDir: string;
  projectPath: string;
};

export type AgentThread = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "cairn" | "subagent";
  sessionFile?: string;
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

type DevLogEmitter = (
  msg:
    | { type: "agent_threads"; threads: AgentThread[] }
    | HydrateDevLogMessage
    | SessionLocationDevLog,
) => void;

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
  const subagentDir = join(CairnDir.sessionsDir(project.path), "subagents");
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

export function emitPersistedSessionDevLogs(
  manager: Pick<SessionManager, "getEntries" | "getSessionFile">,
  project: Project,
  emitDevLog: DevLogEmitter,
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

export function emitSessionLocation(
  manager: SessionManager,
  project: Project,
  emitDevLog: DevLogEmitter,
) {
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) return;
  emitDevLog({
    type: "session_location",
    sessionFile,
    sessionDir: CairnDir.sessionsDir(project.path),
    projectPath: project.path,
  });
}
