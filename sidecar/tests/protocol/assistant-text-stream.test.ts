import { expect, test } from "bun:test";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
  applyAssistantTextStreamEvent,
  createAssistantTextStreamState,
} from "../../protocol/assistant-text-stream";

function assistantMessageEvent(
  event: AgentSessionEvent,
): ReturnType<typeof applyAssistantTextStreamEvent> {
  return applyAssistantTextStreamEvent(createAssistantTextStreamState(), event);
}

function agentEvent(value: object): AgentSessionEvent {
  return value as unknown as AgentSessionEvent;
}

test("streams assistant text deltas", () => {
  const state = createAssistantTextStreamState();
  const outputs = [
    ...applyAssistantTextStreamEvent(
      state,
      agentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      state,
      agentEvent({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Opening" }],
        },
        assistantMessageEvent: { type: "text_delta", delta: "Opening" },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      state,
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Opening" }],
        },
      }),
    ),
  ];

  expect(outputs).toEqual([
    { type: "text_delta", delta: "Opening" },
    { type: "text_done" },
  ]);
});

test("falls back to completed assistant text when no delta streamed", () => {
  expect(
    assistantMessageEvent(
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Decide silently." },
            { type: "text", text: "Here is the visible answer." },
          ],
        },
      }),
    ),
  ).toEqual([
    { type: "text_delta", delta: "Here is the visible answer." },
    { type: "text_done" },
  ]);
});

test("assistant text after a tool result renders through streamed and non-streamed paths", () => {
  const streamedState = createAssistantTextStreamState();
  const streamedOutputs = [
    ...applyAssistantTextStreamEvent(
      streamedState,
      agentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      streamedState,
      agentEvent({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Opening text." }],
        },
        assistantMessageEvent: { type: "text_delta", delta: "Opening text." },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      streamedState,
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Opening text." },
            {
              type: "toolCall",
              id: "tool-call-1",
              name: "ask_user_question",
              arguments: {},
            },
          ],
        },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      streamedState,
      agentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      streamedState,
      agentEvent({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "After the answer." }],
        },
        assistantMessageEvent: {
          type: "text_delta",
          delta: "After the answer.",
        },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      streamedState,
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "After the answer." }],
        },
      }),
    ),
  ];

  expect(streamedOutputs).toEqual([
    { type: "text_delta", delta: "Opening text." },
    { type: "text_done" },
    { type: "text_delta", delta: "After the answer." },
    { type: "text_done" },
  ]);

  const nonStreamedState = createAssistantTextStreamState();
  const nonStreamedOutputs = [
    ...applyAssistantTextStreamEvent(
      nonStreamedState,
      agentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      nonStreamedState,
      agentEvent({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Opening text." }],
        },
        assistantMessageEvent: { type: "text_delta", delta: "Opening text." },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      nonStreamedState,
      agentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      nonStreamedState,
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Keep this hidden." },
            { type: "text", text: "Fallback answer." },
          ],
        },
      }),
    ),
  ];

  expect(nonStreamedOutputs).toEqual([
    { type: "text_delta", delta: "Opening text." },
    { type: "text_done" },
    { type: "text_delta", delta: "Fallback answer." },
    { type: "text_done" },
  ]);
});