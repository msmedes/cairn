import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { SidecarOutMsg } from "./messages";

export type AssistantTextStreamState = {
  streamedAssistantText: boolean;
};

export type AssistantTextStreamOutMsg =
  | Extract<SidecarOutMsg, { type: "text_delta" }>
  | Extract<SidecarOutMsg, { type: "text_done" }>;

export function createAssistantTextStreamState(): AssistantTextStreamState {
  return { streamedAssistantText: false };
}

export function resetAssistantTextStream(state: AssistantTextStreamState) {
  state.streamedAssistantText = false;
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

export function applyAssistantTextStreamEvent(
  state: AssistantTextStreamState,
  event: AgentSessionEvent,
): AssistantTextStreamOutMsg[] {
  switch (event.type) {
    case "message_start": {
      if (event.message.role !== "assistant") {
        return [];
      }

      const shouldFinishPreviousText = state.streamedAssistantText;
      state.streamedAssistantText = false;
      return shouldFinishPreviousText ? [{ type: "text_done" }] : [];
    }
    case "message_update":
      if (event.assistantMessageEvent.type !== "text_delta") {
        return [];
      }
      state.streamedAssistantText = true;
      return [
        {
          type: "text_delta",
          delta: event.assistantMessageEvent.delta,
        },
      ];
    case "message_end": {
      if (event.message.role !== "assistant") {
        return [];
      }

      const emittedAssistantText = state.streamedAssistantText;
      state.streamedAssistantText = false;

      if (emittedAssistantText) {
        return [{ type: "text_done" }];
      }

      const fullText = extractAssistantText(event.message.content);
      if (!fullText) {
        return [];
      }
      return [{ type: "text_delta", delta: fullText }, { type: "text_done" }];
    }
    default:
      return [];
  }
}
