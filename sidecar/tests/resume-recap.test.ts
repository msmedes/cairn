import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import {
  hasInFlightTurn,
  maybeSendResumeRecap,
  RESUME_RECAP_HINT,
} from "../resume-recap";

const NOW = Date.parse("2026-04-28T12:00:00.000Z");

function createSessionManager() {
  const root = mkdtempSync(join(tmpdir(), "guide-recap-"));
  return SessionManager.create(root, join(root, "sessions"));
}

function shiftLeafTimestamp(sessionManager: SessionManager, shiftMs: number) {
  const leafEntry = sessionManager.getLeafEntry();
  if (!leafEntry) {
    throw new Error("expected a leaf entry");
  }
  leafEntry.timestamp = new Date(NOW - shiftMs).toISOString();
}

test("hasInFlightTurn is false after an assistant turn and true for a dangling user turn", () => {
  const completeSession = createSessionManager();
  completeSession.appendMessage({
    role: "user",
    content: "Build me a quiz app.",
    timestamp: NOW - 10_000,
  });
  completeSession.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Who will use it?" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: NOW - 9_000,
  });

  const inFlightSession = createSessionManager();
  inFlightSession.appendMessage({
    role: "user",
    content: "Build me a quiz app.",
    timestamp: NOW - 10_000,
  });

  expect(hasInFlightTurn(completeSession)).toBe(false);
  expect(hasInFlightTurn(inFlightSession)).toBe(true);
});

test("maybeSendResumeRecap injects a hidden hint after a long absence", async () => {
  const sessionManager = createSessionManager();
  sessionManager.appendMessage({
    role: "user",
    content: "Build me a quiz app.",
    timestamp: NOW - 10_000,
  });
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Who will use it?" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: NOW - 9_000,
  });
  shiftLeafTimestamp(sessionManager, 31 * 60 * 1000);

  const calls: Array<{
    message: {
      customType: string;
      content: string | unknown[];
      display: boolean;
    };
    options:
      | { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
      | undefined;
  }> = [];

  const fired = await maybeSendResumeRecap(
    {
      sendCustomMessage: async (message, options) => {
        calls.push({ message, options });
      },
    },
    sessionManager,
    NOW,
  );

  expect(fired).toBe(true);
  expect(calls).toEqual([
    {
      message: {
        customType: "guide.resume",
        content: RESUME_RECAP_HINT,
        display: false,
      },
      options: { triggerTurn: true },
    },
  ]);
});

test("maybeSendResumeRecap stays quiet for recent or in-flight sessions", async () => {
  const recentSession = createSessionManager();
  recentSession.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Who will use it?" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: NOW - 1_000,
  });
  shiftLeafTimestamp(recentSession, 5 * 60 * 1000);

  const inFlightSession = createSessionManager();
  inFlightSession.appendMessage({
    role: "user",
    content: "Build me a quiz app.",
    timestamp: NOW - 10_000,
  });
  shiftLeafTimestamp(inFlightSession, 31 * 60 * 1000);

  const calls: unknown[] = [];
  const stubSession = {
    sendCustomMessage: async (...args: unknown[]) => {
      calls.push(args);
    },
  };

  expect(await maybeSendResumeRecap(stubSession, recentSession, NOW)).toBe(
    false,
  );
  expect(await maybeSendResumeRecap(stubSession, inFlightSession, NOW)).toBe(
    false,
  );
  expect(calls).toEqual([]);
});
