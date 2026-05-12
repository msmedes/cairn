import { expect, test } from "bun:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
  translateSessionEntriesToDevLogMessages,
  translateSessionEntriesToHydrateEvent,
} from "../../protocol/hydrate";

function messageEntry(
  id: string,
  role: "user" | "assistant" | "toolResult",
  content: unknown,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-04-28T00:00:00.000Z",
    message: {
      role,
      content,
      timestamp: Date.now(),
      ...(role === "assistant"
        ? {
            api: "anthropic",
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
          }
        : role === "toolResult"
          ? {
              toolCallId: "tool-1",
              toolName: "read",
              isError: false,
            }
          : {}),
    } as SessionEntry extends { message: infer Message } ? Message : never,
  };
}

test("translateSessionEntriesToHydrateEvent preserves user/assistant order and skips tool output", () => {
  const entries: SessionEntry[] = [
    messageEntry("user-1", "user", "Build me a quiz app."),
    messageEntry("tool-1", "toolResult", [
      { type: "text", text: "tool output that should not hydrate" },
    ]),
    messageEntry("assistant-1", "assistant", [
      { type: "thinking", thinking: "private" } as never,
      { type: "text", text: "Who will write the questions?" },
    ]),
    {
      type: "custom_message",
      id: "custom-1",
      parentId: null,
      timestamp: "2026-04-28T00:00:01.000Z",
      customType: "cairn.resume",
      content: "hidden recap",
      display: false,
    },
    messageEntry("user-2", "user", [
      { type: "text", text: "Teachers will." },
      { type: "image", image: "ignored" } as never,
    ]),
  ];

  expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
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
        text: "Who will write the questions?",
        done: true,
      },
      {
        id: "user-2",
        role: "user",
        text: "Teachers will.",
        done: true,
      },
    ],
  });
});

test("translateSessionEntriesToHydrateEvent drops non-text user and assistant entries", () => {
  const entries: SessionEntry[] = [
    messageEntry("assistant-1", "assistant", [
      { type: "toolCall", toolCallId: "call-1" } as never,
    ]),
    messageEntry("user-1", "user", [
      { type: "image", image: "ignored" } as never,
    ]),
  ];

  expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
    type: "hydrate",
    messages: [],
  });
});

test("translateSessionEntriesToHydrateEvent preserves multi-block text exactly", () => {
  const entries: SessionEntry[] = [
    messageEntry("assistant-1", "assistant", [
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
      { type: "text", text: " again" },
    ]),
  ];

  expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
    type: "hydrate",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "Hello world again",
        done: true,
      },
    ],
  });
});

test("translateSessionEntriesToHydrateEvent hydrates text and image content", () => {
  const entries: SessionEntry[] = [
    messageEntry("user-1", "user", [
      { type: "text", text: "What is wrong here?" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]),
  ];

  expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
    type: "hydrate",
    messages: [
      {
        id: "user-1",
        role: "user",
        text: "What is wrong here?",
        done: true,
        images: [
          {
            dataUrl: "data:image/png;base64,aW1hZ2U=",
            mimeType: "image/png",
          },
        ],
      },
    ],
  });
});

test("translateSessionEntriesToHydrateEvent preserves user text that matches the old image-only fallback", () => {
  const entries: SessionEntry[] = [
    messageEntry("user-1", "user", [
      { type: "text", text: "Please look at the attached image." },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]),
  ];

  expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
    type: "hydrate",
    messages: [
      {
        id: "user-1",
        role: "user",
        text: "Please look at the attached image.",
        done: true,
        images: [
          {
            dataUrl: "data:image/png;base64,aW1hZ2U=",
            mimeType: "image/png",
          },
        ],
      },
    ],
  });
});

test("translateSessionEntriesToHydrateEvent preserves image-only user messages", () => {
  const entries: SessionEntry[] = [
    messageEntry("user-1", "user", [
      { type: "image", data: "b25seS1pbWFnZQ==", mimeType: "image/jpeg" },
    ]),
  ];

  expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
    type: "hydrate",
    messages: [
      {
        id: "user-1",
        role: "user",
        text: "",
        done: true,
        images: [
          {
            dataUrl: "data:image/jpeg;base64,b25seS1pbWFnZQ==",
            mimeType: "image/jpeg",
          },
        ],
      },
    ],
  });
});

test("translateSessionEntriesToDevLogMessages includes tool calls and results", () => {
  const assistantEntry = messageEntry("assistant-1", "assistant", [
    {
      type: "toolCall",
      id: "call-1",
      name: "spawn_subagent",
      arguments: {
        skill_name: "implement-issue",
        response_schema: "task_outcome",
      },
    } as never,
  ]);
  const toolEntry = messageEntry("tool-1", "toolResult", [
    { type: "text", text: '{"outcome":"complete","message":"Done"}' },
  ]);

  const assistantMessage = (assistantEntry as { message: unknown }).message;
  const toolMessage = (toolEntry as { message: unknown }).message;

  expect(
    translateSessionEntriesToDevLogMessages([assistantEntry, toolEntry]),
  ).toEqual([
    {
      type: "session_event",
      event: {
        type: "message_end",
        timestamp: "2026-04-28T00:00:00.000Z",
        message: assistantMessage,
      },
    },
    {
      type: "session_event",
      event: {
        type: "message_end",
        timestamp: "2026-04-28T00:00:00.000Z",
        message: toolMessage,
      },
    },
  ]);
});
