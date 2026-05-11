import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useSidecarSession } from "./useSidecarSession";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

function noop() {}

function bootstrapTauriRuntime() {
  (
    window as typeof window & { __TAURI_INTERNALS__?: unknown }
  ).__TAURI_INTERNALS__ = {};
}

describe("useSidecarSession", () => {
  beforeEach(() => {
    bootstrapTauriRuntime();
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(noop);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_sidecar_status") {
        return Promise.resolve({
          ready: true,
          error: null,
          hydrate: null,
          activeProject: null,
          recents: [],
        });
      }
      return Promise.resolve(null);
    });
  });

  test("sendPrompt forwards image payloads and keeps thumbnails in the optimistic user message", async () => {
    const { result } = renderHook(() =>
      useSidecarSession({
        onCreatingStarted: noop,
        onAgentEnd: noop,
        onHydrate: noop,
        onError: noop,
      }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      await result.current.sendPrompt("", [
        {
          data: "AQID",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AQID",
        },
      ]);
    });

    expect(invokeMock).toHaveBeenCalledWith("send_prompt", {
      text: "",
      images: [{ data: "AQID", mimeType: "image/png" }],
    });
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      text: "",
      images: [
        { dataUrl: "data:image/png;base64,AQID", mimeType: "image/png" },
      ],
    });
  });
});
