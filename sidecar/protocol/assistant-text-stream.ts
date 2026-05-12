import type { Message } from "@mariozechner/pi-ai";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { SidecarOutMsg } from "./messages";

export type AssistantTextStreamState = {
  streamedAssistantText: boolean;
  currentAssistantText: string;
  completedAssistantMessages: WeakSet<object>;
  completedAssistantMessageSignatures: Set<string>;
};

type AssistantTextMessage = Extract<Message, { role: "assistant" }>;

export type AssistantTextStreamOutMsg =
  | Extract<SidecarOutMsg, { type: "text_delta" }>
  | Extract<SidecarOutMsg, { type: "text_done" }>;

export function createAssistantTextStreamState(): AssistantTextStreamState {
  return {
    streamedAssistantText: false,
    currentAssistantText: "",
    completedAssistantMessages: new WeakSet(),
    completedAssistantMessageSignatures: new Set(),
  };
}

export function resetAssistantTextStream(state: AssistantTextStreamState) {
  state.streamedAssistantText = false;
  state.currentAssistantText = "";
  state.completedAssistantMessages = new WeakSet();
  state.completedAssistantMessageSignatures = new Set();
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

function messageKey(message: unknown): object | null {
  return message && typeof message === "object" ? message : null;
}

function assistantMessageSignature(
  message: AssistantTextMessage,
  text: string,
): string | null {
  if (message.responseId) return `response:${message.responseId}`;

  if (message.timestamp !== undefined && message.stopReason) {
    return `completed:${message.timestamp}:${message.stopReason}:${text}`;
  }

  return null;
}

function rememberCompletedAssistantText(
  state: AssistantTextStreamState,
  message: AssistantTextMessage,
  text: string,
) {
  const key = messageKey(message);
  if (key) {
    state.completedAssistantMessages.add(key);
  }
  const signature = assistantMessageSignature(message, text);
  if (signature) {
    state.completedAssistantMessageSignatures.add(signature);
  }
  state.currentAssistantText = "";
}

function extractLastAssistantTextMessage(
  messages: unknown,
): { message: AssistantTextMessage; text: string } | null {
  if (!Array.isArray(messages)) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !message ||
      typeof message !== "object" ||
      !("role" in message) ||
      message.role !== "assistant"
    ) {
      continue;
    }

    const text = extractAssistantText(message.content);
    if (text) {
      return { message, text };
    }
  }

  return null;
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
      state.currentAssistantText = "";
      return shouldFinishPreviousText ? [{ type: "text_done" }] : [];
    }
    case "message_update":
      if (event.assistantMessageEvent.type !== "text_delta") {
        return [];
      }
      state.streamedAssistantText = true;
      state.currentAssistantText += event.assistantMessageEvent.delta;
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
        rememberCompletedAssistantText(
          state,
          event.message,
          state.currentAssistantText,
        );
        return [{ type: "text_done" }];
      }

      const fullText = extractAssistantText(event.message.content);
      if (!fullText) {
        return [];
      }
      rememberCompletedAssistantText(state, event.message, fullText);
      return [{ type: "text_delta", delta: fullText }, { type: "text_done" }];
    }
    case "agent_end": {
      const lastAssistantTextMessage = extractLastAssistantTextMessage(
        event.messages,
      );
      if (!lastAssistantTextMessage) return [];

      const message = messageKey(lastAssistantTextMessage.message);
      const signature = assistantMessageSignature(
        lastAssistantTextMessage.message,
        lastAssistantTextMessage.text,
      );
      if (
        (message && state.completedAssistantMessages.has(message)) ||
        (signature && state.completedAssistantMessageSignatures.has(signature))
      ) {
        return [];
      }

      rememberCompletedAssistantText(
        state,
        lastAssistantTextMessage.message,
        lastAssistantTextMessage.text,
      );
      return [
        { type: "text_delta", delta: lastAssistantTextMessage.text },
        { type: "text_done" },
      ];
    }
    default:
      return [];
  }
}
