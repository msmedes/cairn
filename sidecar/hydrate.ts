import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export type HydrateMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: true;
  kind?: "recap";
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

function toHydrateMessage(entry: SessionEntry): HydrateMessage | null {
  if (entry.type !== "message") {
    return null;
  }

  const { message } = entry;
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const text = extractText(message.content);
  if (!text) {
    return null;
  }

  return {
    id: entry.id,
    role: message.role,
    text,
    done: true,
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
