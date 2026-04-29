import { expect, test } from "bun:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { emitHydrateAndMaybeResumeRecap } from "../init-recap";
import { RESUME_RECAP_HINT } from "../resume-recap";

function assistantEntry(timestamp: string) {
  return {
    type: "message" as const,
    id: "assistant-1",
    parentId: "user-1",
    timestamp,
    message: {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Who will use it?" }],
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
      stopReason: "stop" as const,
      timestamp: Date.parse(timestamp),
    },
  };
}

function userEntry(timestamp: string) {
  return {
    type: "message" as const,
    id: "user-1",
    parentId: null,
    timestamp,
    message: {
      role: "user" as const,
      content: "Build me a quiz app.",
      timestamp: Date.parse(timestamp),
    },
  };
}

test("emitHydrateAndMaybeResumeRecap emits an updated hydrate after a recap fires", async () => {
  const firstTimestamp = "2026-04-28T11:20:00.000Z";
  const recapTimestamp = "2026-04-28T12:00:00.000Z";
  const entries: SessionEntry[] = [
    userEntry(firstTimestamp),
    assistantEntry(firstTimestamp),
  ];
  const hydrateEvents: unknown[] = [];
  const sent: unknown[] = [];

  await emitHydrateAndMaybeResumeRecap(
    {
      sendCustomMessage: async (message, options) => {
        sent.push({ message, options });
        entries.push({
          type: "custom_message",
          id: "hidden-recap",
          parentId: "assistant-1",
          timestamp: recapTimestamp,
          customType: "guide.resume",
          content: RESUME_RECAP_HINT,
          display: false,
        });
        entries.push({
          type: "message",
          id: "assistant-2",
          parentId: "hidden-recap",
          timestamp: recapTimestamp,
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Last time we were sketching the quiz flow. Want to pick that up or change direction?",
              },
            ],
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
            timestamp: Date.parse(recapTimestamp),
          },
        });
      },
    },
    {
      getEntries: () => entries,
      getLeafEntry: () => entries.at(-1),
    },
    {
      emitHydrate: (event) => hydrateEvents.push(event),
      onRecapError: (error) => {
        throw error;
      },
    },
  );

  expect(sent).toEqual([
    {
      message: {
        customType: "guide.resume",
        content: RESUME_RECAP_HINT,
        display: false,
      },
      options: { triggerTurn: true },
    },
  ]);
  expect(hydrateEvents).toEqual([
    {
      type: "hydrate",
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "Build me a quiz app.",
          done: true,
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "Who will use it?",
          done: true,
        },
      ],
    },
    {
      type: "hydrate",
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "Build me a quiz app.",
          done: true,
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "Who will use it?",
          done: true,
        },
        {
          id: "assistant-2",
          role: "assistant",
          text: "Last time we were sketching the quiz flow. Want to pick that up or change direction?",
          done: true,
          kind: "recap",
        },
      ],
    },
  ]);
});

test("emitHydrateAndMaybeResumeRecap always emits the initial hydrate and swallows recap failures", async () => {
  const entries: SessionEntry[] = [
    userEntry("2026-04-28T11:20:00.000Z"),
    assistantEntry("2026-04-28T11:20:00.000Z"),
  ];
  const hydrateEvents: unknown[] = [];
  const errors: string[] = [];

  await emitHydrateAndMaybeResumeRecap(
    {
      sendCustomMessage: async () => {
        throw new Error("model offline");
      },
    },
    {
      getEntries: () => entries,
      getLeafEntry: () => entries.at(-1),
    },
    {
      emitHydrate: (event) => hydrateEvents.push(event),
      onRecapError: (error) => errors.push((error as Error).message),
    },
  );

  expect(hydrateEvents).toHaveLength(1);
  expect(errors).toEqual(["model offline"]);
});
