import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useSidecarSession } from "./useSidecarSession";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const sidecarEventHandlers = vi.hoisted(
  () => [] as Array<(event: { payload: unknown }) => void>,
);
let sidecarStatusSnapshot: Record<string, unknown>;

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
    sidecarEventHandlers.length = 0;
    sidecarStatusSnapshot = {
      ready: true,
      error: null,
      hydrate: null,
      activeProject: null,
      recents: [],
    };
    listenMock.mockImplementation(
      async (
        eventName: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
        if (eventName === "sidecar-event") {
          sidecarEventHandlers.push(handler);
        }
        return noop;
      },
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_sidecar_status") {
        return Promise.resolve(sidecarStatusSnapshot);
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

  test("pending questions can be submitted or skipped through the sidecar command", async () => {
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

    act(() => {
      sidecarEventHandlers[0]?.({
        payload: {
          type: "ask_user_question",
          toolCallId: "tool-call-1",
          questions: [
            {
              header: "Audience",
              question: "Who should this serve?",
              options: [
                { label: "Leads", description: "Team leads." },
                { label: "Learners", description: "Quiz takers." },
              ],
            },
          ],
        },
      });
    });

    expect(result.current.pendingQuestion?.toolCallId).toBe("tool-call-1");

    await act(async () => {
      await result.current.submitQuestionAnswer([
        {
          questionIndex: 0,
          header: "Audience",
          question: "Who should this serve?",
          kind: "option",
          option: { label: "Leads", description: "Team leads." },
        },
      ]);
    });

    expect(invokeMock).toHaveBeenCalledWith("submit_question_answer", {
      toolCallId: "tool-call-1",
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          header: "Audience",
          question: "Who should this serve?",
          kind: "option",
          option: { label: "Leads", description: "Team leads." },
        },
      ],
    });
    expect(result.current.pendingQuestion).toBeNull();

    act(() => {
      sidecarEventHandlers[0]?.({
        payload: {
          type: "ask_user_question",
          toolCallId: "tool-call-2",
          questions: [
            {
              header: "Scope",
              question: "What should come first?",
              options: [
                { label: "Small", description: "One focused slice." },
                { label: "Large", description: "A broader version." },
              ],
            },
          ],
        },
      });
    });

    await act(async () => {
      await result.current.cancelQuestion();
    });

    expect(invokeMock).toHaveBeenCalledWith("submit_question_answer", {
      toolCallId: "tool-call-2",
      cancelled: true,
      answers: [],
    });
  });

  test("restores a pending question from the sidecar status snapshot", async () => {
    sidecarStatusSnapshot = {
      ...sidecarStatusSnapshot,
      pendingQuestion: {
        toolCallId: "tool-call-snapshot",
        questions: [
          {
            header: "Audience",
            question: "Who should this serve?",
            options: [
              { label: "Leads", description: "Team leads." },
              { label: "Learners", description: "Quiz takers." },
            ],
          },
        ],
      },
    };

    const { result } = renderHook(() =>
      useSidecarSession({
        onCreatingStarted: noop,
        onAgentEnd: noop,
        onHydrate: noop,
        onError: noop,
      }),
    );

    await waitFor(() => {
      expect(result.current.pendingQuestion?.toolCallId).toBe(
        "tool-call-snapshot",
      );
    });
  });

  test("guards duplicate question submissions while the command is in flight", async () => {
    let resolveSubmit: (() => void) | null = null;
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_sidecar_status") {
        return Promise.resolve(sidecarStatusSnapshot);
      }
      if (command === "submit_question_answer") {
        return new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        });
      }
      return Promise.resolve(null);
    });
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
    act(() => {
      sidecarEventHandlers[0]?.({
        payload: {
          type: "ask_user_question",
          toolCallId: "tool-call-1",
          questions: [
            {
              header: "Audience",
              question: "Who should this serve?",
              options: [
                { label: "Leads", description: "Team leads." },
                { label: "Learners", description: "Quiz takers." },
              ],
            },
          ],
        },
      });
    });

    const answers = [
      {
        questionIndex: 0,
        header: "Audience",
        question: "Who should this serve?",
        kind: "option" as const,
        option: { label: "Leads", description: "Team leads." },
      },
    ];
    let firstSubmit = Promise.resolve();
    await act(async () => {
      firstSubmit = result.current.submitQuestionAnswer(answers);
      void result.current.submitQuestionAnswer(answers);
    });

    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "submit_question_answer",
      ),
    ).toHaveLength(1);

    await act(async () => {
      resolveSubmit?.();
      await firstSubmit;
    });
  });
});
