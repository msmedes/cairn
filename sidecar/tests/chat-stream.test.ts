import { expect, test } from "bun:test";
import { applyAssistantDelta, markAssistantDone } from "../../src/chat-stream";

test("applyAssistantDelta appends to the active assistant turn", () => {
  const result = applyAssistantDelta(
    [
      { id: "user-1", role: "user", text: "hello", done: true },
      { id: "assistant-1", role: "assistant", text: "hi", done: false },
    ],
    "assistant-1",
    " there",
    () => "unused",
  );

  expect(result).toEqual({
    activeAssistantId: "assistant-1",
    messages: [
      { id: "user-1", role: "user", text: "hello", done: true },
      { id: "assistant-1", role: "assistant", text: "hi there", done: false },
    ],
  });
});

test("applyAssistantDelta creates a new assistant turn for spontaneous output", () => {
  const result = applyAssistantDelta(
    [{ id: "user-1", role: "user", text: "hello", done: true }],
    null,
    "Last time we were working on the quiz flow.",
    () => "assistant-recap",
  );

  expect(result).toEqual({
    activeAssistantId: "assistant-recap",
    messages: [
      { id: "user-1", role: "user", text: "hello", done: true },
      {
        id: "assistant-recap",
        role: "assistant",
        text: "Last time we were working on the quiz flow.",
        done: false,
      },
    ],
  });
});

test("markAssistantDone finalizes the active assistant turn", () => {
  expect(
    markAssistantDone(
      [{ id: "assistant-1", role: "assistant", text: "hi", done: false }],
      "assistant-1",
    ),
  ).toEqual([{ id: "assistant-1", role: "assistant", text: "hi", done: true }]);
});
