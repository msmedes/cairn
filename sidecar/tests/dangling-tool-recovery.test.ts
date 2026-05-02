import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDanglingToolCall,
  recoverDanglingToolCall,
  recoverDanglingToolCallInDir,
  synthesizeRecoveryEntry,
} from "../dangling-tool-recovery";

function assistantWithToolCalls(
  id: string,
  parentId: string,
  toolCalls: Array<{ id: string; name: string; arguments?: unknown }>,
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-04-30T23:53:45.428Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "On to the next piece." },
        ...toolCalls.map((call) => ({
          type: "toolCall",
          id: call.id,
          name: call.name,
          arguments: call.arguments ?? {},
        })),
      ],
    },
  };
}

function toolResultEntry(
  id: string,
  parentId: string,
  toolCallId: string,
  toolName: string,
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-04-30T23:53:46.000Z",
    message: {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 1777593226000,
    },
  };
}

describe("findDanglingToolCall", () => {
  test("returns null for empty entries", () => {
    expect(findDanglingToolCall([])).toBeNull();
  });

  test("returns null when no assistant messages exist", () => {
    const entries = [
      { type: "session", id: "s1" },
      {
        type: "message",
        id: "u1",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      },
    ];
    expect(findDanglingToolCall(entries)).toBeNull();
  });

  test("returns null when assistant message has no tool calls", () => {
    const entries = [
      {
        type: "message",
        id: "a1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      },
    ];
    expect(findDanglingToolCall(entries)).toBeNull();
  });

  test("returns null when every tool call has a matching tool result", () => {
    const entries = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
      toolResultEntry("r1", "a1", "tc_001", "start_task"),
    ];
    expect(findDanglingToolCall(entries)).toBeNull();
  });

  test("returns the dangling call when no tool result follows", () => {
    const entries = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
    ];
    const dangling = findDanglingToolCall(entries);
    expect(dangling).toEqual({
      toolCallId: "tc_001",
      toolName: "start_task",
      parentEntryId: "a1",
      args: {},
    });
  });

  test("returns the first dangling call when multiple unanswered calls exist", () => {
    const entries = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
        { id: "tc_002", name: "edit" },
      ]),
    ];
    const dangling = findDanglingToolCall(entries);
    expect(dangling?.toolCallId).toBe("tc_001");
  });

  test("recognizes results that follow even with intervening entries", () => {
    const entries = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
      { type: "model_change", id: "mc1" },
      toolResultEntry("r1", "a1", "tc_001", "start_task"),
    ];
    expect(findDanglingToolCall(entries)).toBeNull();
  });

  test("walks from the end so an earlier dangling call is ignored once later assistant turn is complete", () => {
    const entries = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
      toolResultEntry("r1", "a1", "tc_001", "start_task"),
      assistantWithToolCalls("a2", "r1", [
        { id: "tc_002", name: "verify_slice" },
      ]),
      toolResultEntry("r2", "a2", "tc_002", "verify_slice"),
    ];
    expect(findDanglingToolCall(entries)).toBeNull();
  });
});

describe("synthesizeRecoveryEntry", () => {
  test("start_task synth has structured failure outcome", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_001",
      toolName: "start_task",
      parentEntryId: "a1",
      args: {},
    });
    expect(entry.type).toBe("message");
    expect(entry.parentId).toBe("a1");
    expect(entry.message.role).toBe("toolResult");
    expect(entry.message.toolCallId).toBe("tc_001");
    expect(entry.message.toolName).toBe("start_task");
    expect(entry.message.isError).toBe(false);
    expect(entry.message.details).toEqual({
      outcome: "failure",
      message: expect.stringContaining("interrupted"),
    });
    const text = entry.message.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.outcome).toBe("failure");
  });

  test("verify_slice synth has structured ok:false payload", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_002",
      toolName: "verify_slice",
      parentEntryId: "a2",
      args: {},
    });
    expect(entry.message.toolName).toBe("verify_slice");
    expect(entry.message.isError).toBe(false);
    expect(entry.message.details).toEqual({
      ok: false,
      message: expect.stringContaining("interrupted"),
    });
  });

  test("unknown tool falls back to isError:true text result", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_999",
      toolName: "bash",
      parentEntryId: "a9",
      args: {},
    });
    expect(entry.message.toolName).toBe("bash");
    expect(entry.message.isError).toBe(true);
    expect(entry.message.content[0].text).toContain("bash");
    expect(entry.message.content[0].text).toContain("interrupted");
  });

  test("generates a non-empty id distinct from parent", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_001",
      toolName: "start_task",
      parentEntryId: "a1",
      args: {},
    });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.id).not.toBe("a1");
  });

  test("uses ISO timestamp on the outer entry and ms on the inner message", () => {
    const before = Date.now();
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_001",
      toolName: "start_task",
      parentEntryId: "a1",
      args: {},
    });
    const after = Date.now();
    expect(typeof entry.timestamp).toBe("string");
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
    expect(entry.message.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.message.timestamp).toBeLessThanOrEqual(after);
  });

  test("spawn_subagent task_outcome synth matches start_task structured failure outcome", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_task",
      toolName: "spawn_subagent",
      parentEntryId: "a_task",
      args: { response_schema: "task_outcome" },
    });
    const details = {
      outcome: "failure",
      message: "Previous run was interrupted before finishing this piece.",
    };
    expect(entry.message.toolName).toBe("spawn_subagent");
    expect(entry.message.isError).toBe(false);
    expect(entry.message.details).toEqual(details);
    expect(entry.message.content[0].text).toBe(JSON.stringify(details));
  });

  test("spawn_subagent verify_result synth has structured ok:false payload", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_verify",
      toolName: "spawn_subagent",
      parentEntryId: "a_verify",
      args: { response_schema: "verify_result" },
    });
    const details = {
      ok: false,
      message: "Previous run was interrupted before finishing the build check.",
    };
    expect(entry.message.isError).toBe(false);
    expect(entry.message.details).toEqual(details);
    expect(entry.message.content[0].text).toBe(JSON.stringify(details));
  });

  test("spawn_subagent artifact_write synth has structured failure payload with blank path", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_artifact",
      toolName: "spawn_subagent",
      parentEntryId: "a_artifact",
      args: { response_schema: "artifact_write" },
    });
    const details = {
      outcome: "failure",
      message: "Previous run was interrupted before finishing this artifact.",
      path: "",
    };
    expect(entry.message.isError).toBe(false);
    expect(entry.message.details).toEqual(details);
    expect(entry.message.content[0].text).toBe(JSON.stringify(details));
  });

  test("spawn_subagent missing response_schema falls back to isError:true text result", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_missing",
      toolName: "spawn_subagent",
      parentEntryId: "a_missing",
      args: {},
    });
    expect(entry.message.isError).toBe(true);
    expect(entry.message.details).toBeUndefined();
    expect(entry.message.content[0].text).toContain("spawn_subagent");
    expect(entry.message.content[0].text).toContain("interrupted");
  });

  test("spawn_subagent unknown response_schema falls back to isError:true text result", () => {
    const entry = synthesizeRecoveryEntry({
      toolCallId: "tc_unknown_schema",
      toolName: "spawn_subagent",
      parentEntryId: "a_unknown_schema",
      args: { response_schema: "surprise" },
    });
    expect(entry.message.isError).toBe(true);
    expect(entry.message.details).toBeUndefined();
    expect(entry.message.content[0].text).toContain("spawn_subagent");
    expect(entry.message.content[0].text).toContain("interrupted");
  });
});

describe("recoverDanglingToolCall", () => {
  test("returns null on empty content", () => {
    expect(recoverDanglingToolCall("")).toBeNull();
    expect(recoverDanglingToolCall("\n\n")).toBeNull();
  });

  test("returns null when the session is whole", () => {
    const lines = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
      toolResultEntry("r1", "a1", "tc_001", "start_task"),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    expect(recoverDanglingToolCall(lines)).toBeNull();
  });

  test("returns a JSON line for the synthesized recovery entry when dangling", () => {
    const lines = [
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const recovered = recoverDanglingToolCall(lines);
    expect(recovered).not.toBeNull();
    if (recovered === null) throw new Error("expected recovery line");
    const parsed = JSON.parse(recovered);
    expect(parsed.message.role).toBe("toolResult");
    expect(parsed.message.toolCallId).toBe("tc_001");
    expect(parsed.message.toolName).toBe("start_task");
    expect(parsed.parentId).toBe("a1");
  });

  test("ignores malformed lines and still recovers", () => {
    const valid = JSON.stringify(
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
    );
    const lines = `{not json}\n${valid}\n`;
    expect(recoverDanglingToolCall(lines)).not.toBeNull();
  });

  test("returns a JSON line for spawn_subagent using the dangling call response_schema", () => {
    const lines = [
      assistantWithToolCalls("a1", "u0", [
        {
          id: "tc_spawn",
          name: "spawn_subagent",
          arguments: { response_schema: "artifact_write" },
        },
      ]),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const recovered = recoverDanglingToolCall(lines);
    expect(recovered).not.toBeNull();
    if (recovered === null) throw new Error("expected recovery line");
    const parsed = JSON.parse(recovered);
    expect(parsed.message.role).toBe("toolResult");
    expect(parsed.message.toolCallId).toBe("tc_spawn");
    expect(parsed.message.toolName).toBe("spawn_subagent");
    expect(parsed.message.isError).toBe(false);
    expect(parsed.message.details).toEqual({
      outcome: "failure",
      message: "Previous run was interrupted before finishing this artifact.",
      path: "",
    });
  });
});

describe("recoverDanglingToolCallInDir", () => {
  test("returns null for a missing or empty session dir", () => {
    const empty = mkdtempSync(join(tmpdir(), "cairn-recovery-empty-"));
    expect(recoverDanglingToolCallInDir(empty)).toBeNull();
    expect(
      recoverDanglingToolCallInDir(join(empty, "does-not-exist")),
    ).toBeNull();
  });

  test("appends a synthetic line to the latest jsonl when dangling", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-recovery-"));
    const file = join(dir, "2026-04-30T23-12-12-409Z_abc.jsonl");
    const original = `${JSON.stringify(
      assistantWithToolCalls("a1", "u0", [
        { id: "tc_001", name: "start_task" },
      ]),
    )}\n`;
    writeFileSync(file, original);

    const modified = recoverDanglingToolCallInDir(dir);
    expect(modified).toBe(file);

    const after = readFileSync(file, "utf8");
    expect(after.startsWith(original)).toBe(true);
    const lines = after.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(2);
    const appended = JSON.parse(lines[1]);
    expect(appended.message.role).toBe("toolResult");
    expect(appended.message.toolCallId).toBe("tc_001");
  });

  test("appends an idempotent synthetic line for dangling spawn_subagent", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-recovery-spawn-"));
    const file = join(dir, "2026-04-30T23-12-12-409Z_abc.jsonl");
    const original = `${JSON.stringify(
      assistantWithToolCalls("a1", "u0", [
        {
          id: "tc_spawn",
          name: "spawn_subagent",
          arguments: { response_schema: "task_outcome" },
        },
      ]),
    )}\n`;
    writeFileSync(file, original);

    expect(recoverDanglingToolCallInDir(dir)).toBe(file);
    expect(recoverDanglingToolCallInDir(dir)).toBeNull();

    const after = readFileSync(file, "utf8");
    expect(after.startsWith(original)).toBe(true);
    const lines = after.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(2);
    const appended = JSON.parse(lines[1]);
    expect(appended.message.role).toBe("toolResult");
    expect(appended.message.toolCallId).toBe("tc_spawn");
    expect(appended.message.details).toEqual({
      outcome: "failure",
      message: "Previous run was interrupted before finishing this piece.",
    });
  });

  test("is idempotent — second pass appends nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-recovery-idem-"));
    const file = join(dir, "2026-04-30T23-12-12-409Z_abc.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify(
        assistantWithToolCalls("a1", "u0", [
          { id: "tc_001", name: "start_task" },
        ]),
      )}\n`,
    );

    expect(recoverDanglingToolCallInDir(dir)).toBe(file);
    expect(recoverDanglingToolCallInDir(dir)).toBeNull();

    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(2);
  });

  test("handles a jsonl that does not end in a newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-recovery-noeol-"));
    const file = join(dir, "2026-04-30T23-12-12-409Z_abc.jsonl");
    writeFileSync(
      file,
      JSON.stringify(
        assistantWithToolCalls("a1", "u0", [
          { id: "tc_001", name: "start_task" },
        ]),
      ),
    );

    expect(recoverDanglingToolCallInDir(dir)).toBe(file);
    const after = readFileSync(file, "utf8");
    const lines = after.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(2);
  });
});
