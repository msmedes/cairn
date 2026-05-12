export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
  kind?: "recap";
  images?: ChatMessageImage[];
};

export type ChatMessageImage = {
  dataUrl: string;
  mimeType: string;
};

export type AssistantDeltaResult = {
  activeAssistantId: string;
  messages: ChatMessage[];
};

export function applyAssistantDelta(
  messages: ChatMessage[],
  activeAssistantId: string | null,
  delta: string,
  createId: () => string,
): AssistantDeltaResult {
  if (activeAssistantId) {
    return {
      activeAssistantId,
      messages: messages.map((message) =>
        message.id === activeAssistantId
          ? { ...message, text: message.text + delta }
          : message,
      ),
    };
  }

  const nextAssistantId = createId();
  return {
    activeAssistantId: nextAssistantId,
    messages: [
      ...messages,
      {
        id: nextAssistantId,
        role: "assistant",
        text: delta,
        done: false,
      },
    ],
  };
}

export function markAssistantDone(
  messages: ChatMessage[],
  activeAssistantId: string | null,
) {
  if (!activeAssistantId) {
    return messages;
  }

  return messages.flatMap((message) => {
    if (message.id !== activeAssistantId) return [message];
    if (message.role === "assistant" && message.text.trim() === "") return [];
    return [{ ...message, done: true }];
  });
}
