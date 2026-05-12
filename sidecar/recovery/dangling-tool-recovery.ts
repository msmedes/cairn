/**
 * On hydrate, the persona's pi.dev session may end with an assistant message
 * whose tool call has no matching tool result — typically because the parent
 * process was killed mid-call (sub-agent dispatch interrupted, app force-quit,
 * etc.). Replaying that session as-is leaves the model "responding" to a
 * dangling tool call, which is undefined behavior.
 *
 * This module detects the dangling state and synthesizes a tool result entry
 * so the persona's existing retry / failure-handling rules naturally take over
 * on resume. For start_task and verify_slice, the synthesized payload matches
 * the tool's structured contract; for unknown tools it falls back to a generic
 * isError:true text result.
 *
 * The deep module here is the pure-function detection + synthesis. Wiring is
 * done in sidecar/index.ts before SessionManager opens the session file.
 */

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type SessionEntry = {
  type: string;
  id: string;
  parentId?: string;
  timestamp?: string;
  message?: SessionMessage;
};

type SessionMessage = {
  role?: string;
  content?: SessionContentPart[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
  timestamp?: number;
};

type SessionContentPart = {
  type: string;
  id?: string;
  name?: string;
  text?: string;
  arguments?: unknown;
};

export type DanglingToolCall = {
  toolCallId: string;
  toolName: string;
  parentEntryId: string;
  args: unknown;
};

export type RecoveryEntry = {
  type: "message";
  id: string;
  parentId: string;
  timestamp: string;
  message: {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
    isError: boolean;
    timestamp: number;
  };
};

const INTERRUPTED_MESSAGE =
  "Previous run was interrupted before finishing this piece.";
const VERIFY_INTERRUPTED_MESSAGE =
  "Previous run was interrupted before finishing the build check.";
const ARTIFACT_INTERRUPTED_MESSAGE =
  "Previous run was interrupted before finishing this artifact.";

function structuredRecoveryEntry(
  dangling: DanglingToolCall,
  id: string,
  ts: string,
  tsMs: number,
  details: unknown,
): RecoveryEntry {
  return {
    type: "message",
    id,
    parentId: dangling.parentEntryId,
    timestamp: ts,
    message: {
      role: "toolResult",
      toolCallId: dangling.toolCallId,
      toolName: dangling.toolName,
      content: [{ type: "text", text: JSON.stringify(details) }],
      details,
      isError: false,
      timestamp: tsMs,
    },
  };
}

function genericInterruptedEntry(
  dangling: DanglingToolCall,
  id: string,
  ts: string,
  tsMs: number,
): RecoveryEntry {
  return {
    type: "message",
    id,
    parentId: dangling.parentEntryId,
    timestamp: ts,
    message: {
      role: "toolResult",
      toolCallId: dangling.toolCallId,
      toolName: dangling.toolName,
      content: [
        {
          type: "text",
          text: `The ${dangling.toolName} call was interrupted before completing.`,
        },
      ],
      isError: true,
      timestamp: tsMs,
    },
  };
}

function responseSchemaFromArgs(args: unknown): unknown {
  if (!args || typeof args !== "object") return undefined;
  return (args as { response_schema?: unknown }).response_schema;
}

export function findDanglingToolCall(
  entries: SessionEntry[],
): DanglingToolCall | null {
  let lastAssistantIndex = -1;
  let lastAssistantToolCalls: SessionContentPart[] = [];
  let lastAssistantId = "";

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    if (entry.message?.role !== "assistant") continue;

    const calls = (entry.message.content ?? []).filter(
      (part) => part.type === "toolCall",
    );
    if (calls.length === 0) continue;

    lastAssistantIndex = i;
    lastAssistantToolCalls = calls;
    lastAssistantId = entry.id;
    break;
  }

  if (lastAssistantIndex === -1) return null;

  const followingResults = new Set<string>();
  for (let i = lastAssistantIndex + 1; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    if (entry.message?.role !== "toolResult") continue;
    if (entry.message.toolCallId) {
      followingResults.add(entry.message.toolCallId);
    }
  }

  for (const call of lastAssistantToolCalls) {
    if (!call.id || !call.name) continue;
    if (followingResults.has(call.id)) continue;
    return {
      toolCallId: call.id,
      toolName: call.name,
      parentEntryId: lastAssistantId,
      args: call.arguments ?? {},
    };
  }

  return null;
}

export function synthesizeRecoveryEntry(
  dangling: DanglingToolCall,
): RecoveryEntry {
  const id = randomBytes(4).toString("hex");
  const tsMs = Date.now();
  const ts = new Date(tsMs).toISOString();

  if (dangling.toolName === "start_task") {
    const details = { outcome: "failure", message: INTERRUPTED_MESSAGE };
    return structuredRecoveryEntry(dangling, id, ts, tsMs, details);
  }

  if (dangling.toolName === "verify_slice") {
    const details = { ok: false, message: VERIFY_INTERRUPTED_MESSAGE };
    return structuredRecoveryEntry(dangling, id, ts, tsMs, details);
  }

  if (dangling.toolName === "spawn_subagent") {
    const responseSchema = responseSchemaFromArgs(dangling.args);
    if (responseSchema === "task_outcome") {
      return structuredRecoveryEntry(dangling, id, ts, tsMs, {
        outcome: "failure",
        message: INTERRUPTED_MESSAGE,
      });
    }
    if (responseSchema === "verify_result") {
      return structuredRecoveryEntry(dangling, id, ts, tsMs, {
        ok: false,
        message: VERIFY_INTERRUPTED_MESSAGE,
      });
    }
    if (responseSchema === "artifact_write") {
      return structuredRecoveryEntry(dangling, id, ts, tsMs, {
        outcome: "failure",
        message: ARTIFACT_INTERRUPTED_MESSAGE,
        path: "",
      });
    }
  }

  return genericInterruptedEntry(dangling, id, ts, tsMs);
}

export function recoverDanglingToolCall(jsonlContent: string): string | null {
  const entries: SessionEntry[] = jsonlContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as SessionEntry];
      } catch {
        return [];
      }
    });

  const dangling = findDanglingToolCall(entries);
  if (!dangling) return null;

  const synthesized = synthesizeRecoveryEntry(dangling);
  return JSON.stringify(synthesized);
}

function findLatestSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  const files = readdirSync(sessionDir).filter((name) =>
    name.endsWith(".jsonl"),
  );
  if (files.length === 0) return null;
  files.sort();
  return join(sessionDir, files[files.length - 1]);
}

/**
 * Scan the latest session jsonl in a project and append a synthetic toolResult
 * entry if a trailing assistant tool call is unanswered. Idempotent: running
 * twice in a row only appends once because the second pass sees the freshly
 * appended result and returns null.
 *
 * Returns the path of the file that was modified, or null if no recovery was
 * needed.
 */
export function recoverDanglingToolCallInDir(
  sessionDir: string,
): string | null {
  const latest = findLatestSessionFile(sessionDir);
  if (!latest) return null;

  const content = readFileSync(latest, "utf8");
  const recoveryLine = recoverDanglingToolCall(content);
  if (!recoveryLine) return null;

  const trailingNewline = content.endsWith("\n") ? "" : "\n";
  appendFileSync(latest, `${trailingNewline}${recoveryLine}\n`);
  return latest;
}
