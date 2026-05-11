import type { SessionEntry } from "@mariozechner/pi-coding-agent";

const IMAGE_ONLY_PROMPT_TEXT = "Please look at the attached image.";

export type HydrateMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: true;
  kind?: "recap";
  images?: HydrateMessageImage[];
};

export type HydrateMessageImage = {
  dataUrl: string;
  mimeType: string;
};

export type HydrateEvent = {
  type: "hydrate";
  messages: HydrateMessage[];
};

export type HydrateDevLogMessage = {
  type: "session_event";
  event: {
    type: "message_end";
    timestamp?: string;
    message: unknown;
  };
  source?: {
    kind: "parent" | "subagent";
    agentId: string;
    parentAgentId?: string;
    sessionFile?: string;
  };
};

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

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

function extractImages(content: unknown): HydrateMessageImage[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part) => {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "image" &&
      "data" in part &&
      typeof part.data === "string" &&
      "mimeType" in part &&
      typeof part.mimeType === "string"
    ) {
      return [
        {
          dataUrl: `data:${part.mimeType};base64,${part.data}`,
          mimeType: part.mimeType,
        },
      ];
    }
    return [];
  });
}

function toHydrateMessage(entry: SessionEntry): HydrateMessage | null {
  if (entry.type !== "message") {
    return null;
  }

  const { message } = entry;
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const images = message.role === "user" ? extractImages(message.content) : [];
  const text =
    images.length > 0 && extractText(message.content) === IMAGE_ONLY_PROMPT_TEXT
      ? ""
      : extractText(message.content);
  if (!text && images.length === 0) {
    return null;
  }

  return {
    id: entry.id,
    role: message.role,
    text,
    done: true,
    ...(images.length > 0 ? { images } : {}),
  };
}

export function translateSessionEntriesToHydrateEvent(
  entries: SessionEntry[],
): HydrateEvent {
  return {
    type: "hydrate",
    messages: entries.flatMap((entry) => {
      const message = toHydrateMessage(entry);
      return message ? [message] : [];
    }),
  };
}

export function translateSessionEntriesToDevLogMessages(
  entries: Array<{ type?: string; timestamp?: string; message?: unknown }>,
  source?: HydrateDevLogMessage["source"],
): HydrateDevLogMessage[] {
  return entries.flatMap((entry) => {
    if (entry.type !== "message") {
      return [];
    }

    return [
      {
        type: "session_event",
        event: {
          type: "message_end",
          timestamp: entry.timestamp,
          message: entry.message,
        },
        ...(source ? { source } : {}),
      },
    ];
  });
}
