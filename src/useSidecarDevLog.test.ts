import { describe, expect, test } from "vitest";
import { createSidecarDevLogEntry } from "./useSidecarDevLog";

describe("createSidecarDevLogEntry", () => {
  test("preserves replayed session event timestamps", () => {
    const entry = createSidecarDevLogEntry({
      type: "session_event",
      event: {
        type: "message_end",
        timestamp: "2026-05-02T12:34:56.789Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done." }],
        },
      },
    });

    expect(entry.receivedAt).toBe("2026-05-02T12:34:56.789Z");
  });
});
