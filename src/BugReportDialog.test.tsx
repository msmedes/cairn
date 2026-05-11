import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { BugReportDialog } from "./BugReportDialog";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const messages = [
  { id: "m1", role: "user" as const, text: "It broke", done: true },
  { id: "m2", role: "assistant" as const, text: "I am checking", done: false },
];

const devEvents = [
  {
    id: "e1",
    receivedAt: "2026-05-08T12:00:00.000Z",
    payload: { type: "tool_start", name: "spawn_subagent" },
  },
];

describe("BugReportDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("submits the expected bundler payload", async () => {
    invokeMock.mockResolvedValue("/tmp/cairn-bug-1.zip");
    const onClosed = vi.fn();

    render(
      <BugReportDialog
        messages={messages}
        devEvents={devEvents}
        activeProject={{
          path: "/Users/test/Project",
          displayName: "Project",
        }}
        appVersion="0.1.0"
        onClosed={onClosed}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Plan tab froze" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The Plan tab stopped updating after a sub-agent ran." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
    const [command, payload] = invokeMock.mock.calls[0];
    expect(command).toBe("bug_report_bundler");
    expect(payload).toMatchObject({
      projectPath: "/Users/test/Project",
      githubUrl: expect.stringContaining(
        "https://github.com/msmedes/cairn/issues/new?",
      ),
    });
    expect(JSON.parse(payload.devEventsJson)).toMatchObject({
      messages,
      devEvents,
    });
    expect(JSON.parse(payload.metaJson)).toMatchObject({
      appVersion: "0.1.0",
      activeProjectName: "Project",
      title: "Plan tab froze",
      description: "The Plan tab stopped updating after a sub-agent ran.",
    });
    expect(onClosed).toHaveBeenCalledOnce();
  });

  test("scrubs image bytes from submitted messages while preserving attachment markers", async () => {
    invokeMock.mockResolvedValue("/tmp/cairn-bug-1.zip");

    render(
      <BugReportDialog
        messages={[
          {
            id: "m1",
            role: "user",
            text: "Screenshot attached",
            done: true,
            images: [
              {
                dataUrl: "data:image/png;base64,private-image-bytes",
                mimeType: "image/png",
              },
              {
                dataUrl: "data:image/jpeg;base64,other-private-image-bytes",
                mimeType: "image/jpeg",
              },
            ],
          },
          messages[1],
        ]}
        devEvents={devEvents}
        activeProject={{
          path: "/Users/test/Project",
          displayName: "Project",
        }}
        appVersion="0.1.0"
        onClosed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Images leaked" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The bundle included screenshot bytes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
    const [, payload] = invokeMock.mock.calls[0];
    const devEventsJson = payload.devEventsJson;
    expect(devEventsJson).not.toContain("dataUrl");
    expect(devEventsJson).toContain('"mimeType": "image/png"');
    expect(devEventsJson).toContain('"mimeType": "image/jpeg"');
    expect(JSON.parse(devEventsJson).messages).toEqual([
      {
        id: "m1",
        role: "user",
        text: "Screenshot attached",
        done: true,
        images: [{ mimeType: "image/png" }, { mimeType: "image/jpeg" }],
      },
      messages[1],
    ]);
  });

  test("scrubs image bytes from dev event payloads", async () => {
    invokeMock.mockResolvedValue("/tmp/cairn-bug-1.zip");

    render(
      <BugReportDialog
        messages={messages}
        devEvents={[
          {
            id: "e-image",
            receivedAt: "2026-05-08T12:00:00.000Z",
            payload: {
              type: "session_event",
              event: {
                type: "message_update",
                message: {
                  content: [
                    { type: "text", text: "look" },
                    {
                      type: "image",
                      data: "private-base64-image-bytes",
                      mimeType: "image/png",
                    },
                  ],
                },
              },
            },
          },
        ]}
        activeProject={{
          path: "/Users/test/Project",
          displayName: "Project",
        }}
        appVersion="0.1.0"
        onClosed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Images leaked" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The bundle included event image bytes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
    const [, payload] = invokeMock.mock.calls[0];
    const devEventsJson = payload.devEventsJson;
    expect(devEventsJson).not.toContain("private-base64-image-bytes");
    expect(JSON.parse(devEventsJson).devEvents[0].payload).toMatchObject({
      event: {
        message: {
          content: [
            { type: "text", text: "look" },
            { type: "image", mimeType: "image/png" },
          ],
        },
      },
    });
  });

  test("renders an inline error and stays open when bundling fails", async () => {
    invokeMock.mockRejectedValue("zip failed");
    const onClosed = vi.fn();

    render(
      <BugReportDialog
        messages={messages}
        devEvents={devEvents}
        activeProject={null}
        appVersion="0.1.0"
        onClosed={onClosed}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Startup failure" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The app failed before a project opened." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));

    expect(await screen.findByText("zip failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();
  });
});
