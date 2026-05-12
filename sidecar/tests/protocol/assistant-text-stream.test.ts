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

test("multi-tool chain closing text renders through streamed and fallback paths", () => {
  const toolOnlyAssistantTurn = (id: string, name: string) =>
    [
      agentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id,
              name,
              arguments: {},
            },
          ],
        },
      }),
      agentEvent({
        type: "message_start",
        message: { role: "toolResult", content: [] },
      }),
      agentEvent({
        type: "message_end",
        message: {
          role: "toolResult",
          toolCallId: id,
          toolName: name,
          content: [{ type: "text", text: "ok" }],
        },
      }),
    ] as AgentSessionEvent[];

  const streamedState = createAssistantTextStreamState();
  const streamedEvents = [
    agentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    }),
    agentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "On it." }],
      },
      assistantMessageEvent: { type: "text_delta", delta: "On it." },
    }),
    agentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          {
            type: "toolCall",
            id: "tool-call-prd",
            name: "set_creating",
            arguments: {},
          },
        ],
      },
    }),
    ...toolOnlyAssistantTurn("tool-call-subagent-1", "spawn_subagent"),
    ...toolOnlyAssistantTurn("tool-call-issues", "set_creating"),
    ...toolOnlyAssistantTurn("tool-call-subagent-2", "spawn_subagent"),
    ...toolOnlyAssistantTurn("tool-call-plan-creating", "set_creating"),
    ...toolOnlyAssistantTurn("tool-call-plan", "create_plan_artifact"),
    agentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    }),
    agentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Plan's up." }],
      },
      assistantMessageEvent: { type: "text_delta", delta: "Plan's up." },
    }),
    agentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Plan's up." }],
      },
    }),
  ];

  const streamedOutputs = streamedEvents.flatMap((event) =>
    applyAssistantTextStreamEvent(streamedState, event),
  );

  expect(streamedOutputs).toEqual([
    { type: "text_delta", delta: "On it." },
    { type: "text_done" },
    { type: "text_delta", delta: "Plan's up." },
    { type: "text_done" },
  ]);

  const messageEndFallbackState = createAssistantTextStreamState();
  const messageEndFallbackEvents = [
    agentEvent({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1 },
    }),
    agentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "On it." }],
        timestamp: 1,
      },
      assistantMessageEvent: { type: "text_delta", delta: "On it." },
    }),
    agentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          {
            type: "toolCall",
            id: "tool-call-prd",
            name: "set_creating",
            arguments: {},
          },
        ],
        stopReason: "toolUse",
        timestamp: 1,
      },
    }),
    ...toolOnlyAssistantTurn("tool-call-subagent-1", "spawn_subagent"),
    ...toolOnlyAssistantTurn("tool-call-issues", "set_creating"),
    ...toolOnlyAssistantTurn("tool-call-subagent-2", "spawn_subagent"),
    ...toolOnlyAssistantTurn("tool-call-plan-creating", "set_creating"),
    ...toolOnlyAssistantTurn("tool-call-plan", "create_plan_artifact"),
    agentEvent({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 2 },
    }),
    agentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Plan's up." }],
        stopReason: "stop",
        timestamp: 2,
      },
    }),
  ];

  const messageEndFallbackOutputs = messageEndFallbackEvents.flatMap((event) =>
    applyAssistantTextStreamEvent(messageEndFallbackState, event),
  );

  expect(messageEndFallbackOutputs).toEqual([
    { type: "text_delta", delta: "On it." },
    { type: "text_done" },
    { type: "text_delta", delta: "Plan's up." },
    { type: "text_done" },
  ]);

  const agentEndFallbackState = createAssistantTextStreamState();
  const agentEndFallbackEvents = [
    agentEvent({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1 },
    }),
    agentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "On it." }],
        timestamp: 1,
      },
      assistantMessageEvent: { type: "text_delta", delta: "On it." },
    }),
    agentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          {
            type: "toolCall",
            id: "tool-call-prd",
            name: "set_creating",
            arguments: {},
          },
        ],
        stopReason: "toolUse",
        timestamp: 1,
      },
    }),
    ...toolOnlyAssistantTurn("tool-call-subagent-1", "spawn_subagent"),
    ...toolOnlyAssistantTurn("tool-call-issues", "set_creating"),
    ...toolOnlyAssistantTurn("tool-call-subagent-2", "spawn_subagent"),
    ...toolOnlyAssistantTurn("tool-call-plan-creating", "set_creating"),
    ...toolOnlyAssistantTurn("tool-call-plan", "create_plan_artifact"),
    agentEvent({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "On it." }],
          stopReason: "toolUse",
          timestamp: 1,
        },
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tool-call-plan",
              name: "create_plan_artifact",
              arguments: {},
            },
          ],
          stopReason: "toolUse",
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "tool-call-plan",
          toolName: "create_plan_artifact",
          content: [{ type: "text", text: "ok" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Plan's up." }],
          stopReason: "stop",
          timestamp: 3,
        },
      ],
    }),
  ];

  const agentEndFallbackOutputs = agentEndFallbackEvents.flatMap((event) =>
    applyAssistantTextStreamEvent(agentEndFallbackState, event),
  );

  expect(agentEndFallbackOutputs).toEqual([
    { type: "text_delta", delta: "On it." },
    { type: "text_done" },
    { type: "text_delta", delta: "Plan's up." },
    { type: "text_done" },
  ]);
});

test("agent-end fallback deduplicates by completed message identity, not text alone", () => {
  const state = createAssistantTextStreamState();
  const outputs = [
    ...applyAssistantTextStreamEvent(
      state,
      agentEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Same text." }],
          stopReason: "stop",
          timestamp: 1,
        },
      }),
    ),
    ...applyAssistantTextStreamEvent(
      state,
      agentEvent({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Same text." }],
            stopReason: "stop",
            timestamp: 1,
          },
        ],
      }),
    ),
    ...applyAssistantTextStreamEvent(
      state,
      agentEvent({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Same text." }],
            stopReason: "stop",
            timestamp: 2,
          },
        ],
      }),
    ),
  ];

  expect(outputs).toEqual([
    { type: "text_delta", delta: "Same text." },
    { type: "text_done" },
    { type: "text_delta", delta: "Same text." },
    { type: "text_done" },
  ]);
});
