import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";
import type { CreatingTarget } from "./useCreatingIndicator";
import { useProjectFile } from "./useProjectFile";

const devLogMock = vi.hoisted(() => ({
  events: [] as Array<{
    id: string;
    receivedAt: string;
    payload: unknown;
  }>,
}));

vi.mock("./useProjectFile", () => ({
  useProjectFile: vi.fn(),
}));

vi.mock("./useSidecarDevLog", () => ({
  useSidecarDevLog: () => ({
    events: devLogMock.events,
    clearEvents: vi.fn(),
  }),
}));

type SidecarSessionHandlers = {
  onCreatingStarted: (target: CreatingTarget, message: string) => void;
  onAgentEnd: () => void;
  onHydrate: () => void;
  onError: () => void;
};

let sidecarSessionHandlers: SidecarSessionHandlers | null = null;
let mockMessages: Array<{
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
}> = [];

vi.mock("./useSidecarSession", () => ({
  useSidecarSession: (handlers: SidecarSessionHandlers) => {
    sidecarSessionHandlers = handlers;

    return {
      messages: mockMessages,
      ready: true,
      error: null,
      sending: false,
      sendPrompt: vi.fn(),
    };
  },
}));

const mockUseProjectFile = vi.mocked(useProjectFile);

describe("App panel tabs", () => {
  beforeEach(() => {
    sidecarSessionHandlers = null;
    mockMessages = [];
    devLogMock.events = [];
    mockUseProjectFile.mockImplementation((name) => {
      switch (name) {
        case "brief.json":
          return JSON.stringify({
            artifact: "brief",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              title: "Video Quiz Helper",
              summary: "A small tool for training videos.",
              audience: "Team leads",
              success: "A lead can share a quiz.",
              sections: [
                {
                  heading: "What it does first",
                  body: "It turns one training video into one quiz.",
                },
              ],
            },
          });
        case "plan.json":
          return "";
        case "tasks.json":
        case "prds":
        case "issues":
          return "";
        default:
          return "";
      }
    });
  });

  test("switches between the Project artifact and Plan empty state", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: "Project" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "Video Quiz Helper" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("It turns one training video into one quiz."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTitle("Project brief slideshow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));

    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText(
        "Once we agree on what to build first, the plan will show up here.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Project" }));

    expect(
      screen.getByRole("heading", { name: "Video Quiz Helper" }),
    ).toBeInTheDocument();
  });

  test("keeps creating indicator visible on the empty Plan tab", () => {
    render(<App />);

    act(() => {
      sidecarSessionHandlers?.onCreatingStarted(
        "brief",
        "Putting your project together",
      );
    });
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));

    expect(
      screen.getByText("Putting your project together"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Once we agree on what to build first, the plan will show up here.",
      ),
    ).not.toBeInTheDocument();
  });

  test("Plan tab renders plan.json without reading legacy plan.html", () => {
    mockUseProjectFile.mockImplementation((name) => {
      switch (name) {
        case "brief.json":
          return JSON.stringify({
            artifact: "brief",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              title: "Video Quiz Helper",
              summary: "A small tool for training videos.",
              audience: "Team leads",
              success: "A lead can share a quiz.",
              sections: [
                {
                  heading: "What it does first",
                  body: "It turns one training video into one quiz.",
                },
              ],
            },
          });
        case "plan.json":
          return JSON.stringify({
            artifact: "plan",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              title: "First playable quiz",
              summary: "Start with one video and one shareable quiz.",
              fromBrief:
                "The brief asks for lightweight checks, so this proves one quiz end to end.",
              outcomes: ["You'll be able to paste in one training video."],
              pieces: [
                "Create the first quiz draft",
                "Preview it as a learner",
                "Share the finished quiz",
              ],
              notYet: ["Team analytics", "Question banks"],
            },
          });
        case "tasks.json":
        case "prds":
        case "issues":
          return "";
        default:
          return "";
      }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));

    expect(
      screen.getByRole("heading", { name: "First playable quiz" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Create the first quiz draft")).toBeInTheDocument();
    expect(mockUseProjectFile).toHaveBeenCalledWith("plan.json");
    expect(mockUseProjectFile).not.toHaveBeenCalledWith("plan.html");
  });

  test("Plan creating indicator clears when plan.json changes", async () => {
    let planJson = "";
    mockUseProjectFile.mockImplementation((name) => {
      switch (name) {
        case "brief.json":
          return JSON.stringify({
            artifact: "brief",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              title: "Video Quiz Helper",
              summary: "A small tool for training videos.",
              audience: "Team leads",
              success: "A lead can share a quiz.",
              sections: [
                {
                  heading: "What it does first",
                  body: "It turns one training video into one quiz.",
                },
              ],
            },
          });
        case "plan.json":
          return planJson;
        case "tasks.json":
        case "prds":
        case "issues":
          return "";
        default:
          return "";
      }
    });
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));

    act(() => {
      sidecarSessionHandlers?.onCreatingStarted("plan", "Writing the plan");
    });
    expect(screen.getByText("Writing the plan")).toBeInTheDocument();

    planJson = JSON.stringify({
      artifact: "plan",
      schemaVersion: 1,
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-01T12:00:00.000Z",
      data: {
        title: "First playable quiz",
        summary: "Start with one video and one shareable quiz.",
        fromBrief:
          "The brief asks for lightweight checks, so this proves one quiz end to end.",
        outcomes: ["You'll be able to paste in one training video."],
        pieces: [
          "Create the first quiz draft",
          "Preview it as a learner",
          "Share the finished quiz",
        ],
        notYet: ["Team analytics", "Question banks"],
      },
    });
    rerender(<App />);

    expect(screen.queryByText("Writing the plan")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "First playable quiz" }),
    ).toBeInTheDocument();
  });

  test("Tasks tab renders tasks.json and visibly distinguishes task states", () => {
    mockUseProjectFile.mockImplementation((name) => {
      switch (name) {
        case "brief.json":
          return JSON.stringify({
            artifact: "brief",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              title: "Video Quiz Helper",
              summary: "A small tool for training videos.",
              audience: "Team leads",
              success: "A lead can share a quiz.",
              sections: [
                {
                  heading: "What it does first",
                  body: "It turns one training video into one quiz.",
                },
              ],
            },
          });
        case "tasks.json":
          return JSON.stringify({
            artifact: "tasks",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              tasks: [
                {
                  slug: "create-the-first-quiz-draft",
                  issuePath: "issues/01-create-the-first-quiz-draft.md",
                  title: "Create the first quiz draft",
                  status: "todo",
                },
                {
                  slug: "preview-it-as-a-learner",
                  issuePath: "issues/02-preview-it-as-a-learner.md",
                  title: "Preview it as a learner",
                  status: "in_progress",
                },
                {
                  slug: "share-the-finished-quiz",
                  issuePath: "issues/03-share-the-finished-quiz.md",
                  title: "Share the finished quiz",
                  status: "done",
                },
                {
                  slug: "handle-approval",
                  issuePath: "issues/04-handle-approval.md",
                  title: "Handle approval",
                  status: "blocked",
                },
              ],
            },
          });
        case "plan.json":
        case "prds":
        case "issues":
          return "";
        default:
          return "";
      }
    });

    render(<App />);

    expect(screen.getByRole("tab", { name: "Tasks" })).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));

    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByTitle("Project tasks checklist"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Create the first quiz draft")).toBeInTheDocument();
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(mockUseProjectFile).toHaveBeenCalledWith("tasks.json");
    expect(mockUseProjectFile).not.toHaveBeenCalledWith("tasks.html");
  });

  test("does not show Tasks tab for empty tasks.json", () => {
    render(<App />);

    expect(
      screen.queryByRole("tab", { name: "Tasks" }),
    ).not.toBeInTheDocument();
  });

  test("Project tab reads brief.json without reading legacy brief.html", () => {
    render(<App />);

    expect(mockUseProjectFile).toHaveBeenCalledWith("brief.json");
    expect(mockUseProjectFile).not.toHaveBeenCalledWith("brief.html");
    expect(
      screen.getByText("A small tool for training videos."),
    ).toBeInTheDocument();
  });

  test("does not render raw project context as a panel tab or artifact", () => {
    mockUseProjectFile.mockImplementation((name) => {
      switch (name) {
        case "brief.json":
          return JSON.stringify({
            artifact: "brief",
            schemaVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-01T12:00:00.000Z",
            data: {
              title: "Video Quiz Helper",
              summary: "A small tool for training videos.",
              audience: "Team leads",
              success: "A lead can share a quiz.",
              sections: [
                {
                  heading: "What it does first",
                  body: "It turns one training video into one quiz.",
                },
              ],
            },
          });
        case "CONTEXT.md":
          return "# Project Context\n\n## Language\n\n**Hidden**:\nDo not show.";
        case "plan.json":
        case "tasks.json":
        case "prds":
        case "issues":
          return "";
        default:
          return "";
      }
    });

    render(<App />);

    expect(
      screen.queryByRole("tab", { name: /context/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Project Context")).not.toBeInTheDocument();
    expect(mockUseProjectFile).not.toHaveBeenCalledWith("CONTEXT.md");
  });

  test("opens a dev mode layer with visible chat messages and event counts", () => {
    mockMessages = [
      {
        id: "user-1",
        role: "user",
        text: "Build a small quiz helper.",
        done: true,
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "I'll ask one scoping question.",
        done: true,
      },
    ];

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Dev" }));

    const devLayer = screen.getByRole("region", { name: "Developer mode" });
    expect(devLayer).toBeInTheDocument();
    expect(screen.getByText("Session Debug")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(
      within(devLayer).getByText("Build a small quiz helper."),
    ).toBeInTheDocument();
    expect(
      within(devLayer).getByText("I'll ask one scoping question."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(
      within(devLayer).getByText("No dev events yet."),
    ).toBeInTheDocument();
  });

  test("filters dev events by agent thread", () => {
    const childAgentId = "subagent:/tmp/session.jsonl";
    devLogMock.events = [
      {
        id: "threads",
        receivedAt: "2026-05-02T12:00:00.000Z",
        payload: {
          type: "agent_threads",
          threads: [
            { id: "cairn", parentId: null, label: "Cairn", kind: "cairn" },
            {
              id: childAgentId,
              parentId: "cairn",
              label: "implement-issue: 01-import-screen.md",
              kind: "subagent",
              sessionFile: "/tmp/session.jsonl",
            },
          ],
        },
      },
      {
        id: "cairn-tool",
        receivedAt: "2026-05-02T12:00:01.000Z",
        payload: {
          type: "session_event",
          source: { kind: "parent", agentId: "cairn" },
          event: {
            type: "message_end",
            message: {
              role: "assistant",
              usage: {
                input: 10,
                output: 4,
                cacheRead: 2,
                cacheWrite: 1,
              },
              content: [
                {
                  type: "toolCall",
                  name: "set_creating",
                  arguments: { target: "brief" },
                },
              ],
            },
          },
        },
      },
      {
        id: "subagent-tool",
        receivedAt: "2026-05-02T12:00:02.000Z",
        payload: {
          type: "session_event",
          source: {
            kind: "subagent",
            agentId: childAgentId,
            parentAgentId: "cairn",
            sessionFile: "/tmp/session.jsonl",
          },
          event: {
            type: "message_end",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  name: "read",
                  arguments: { path: "issues/01-import-screen.md" },
                },
              ],
            },
          },
        },
      },
    ];

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Dev" }));
    const devLayer = screen.getByRole("region", { name: "Developer mode" });

    expect(
      within(devLayer).getByRole("combobox", { name: "Agent" }),
    ).toBeInTheDocument();
    expect(within(devLayer).getByText("All agents (3)")).toBeInTheDocument();
    const agentSelect = within(devLayer).getByRole("combobox", {
      name: "Agent",
    });
    expect(
      within(agentSelect).getByRole("option", { name: "Cairn (2)" }),
    ).toBeInTheDocument();
    expect(
      within(agentSelect).getByRole("option", {
        name: /implement-issue: 01-import-screen\.md \(1\)/,
      }),
    ).toBeInTheDocument();

    fireEvent.change(agentSelect, {
      target: { value: childAgentId },
    });

    expect(
      within(devLayer).getByText("subagent tool call: read"),
    ).toBeInTheDocument();
    expect(
      within(devLayer).queryByText("tool call: set_creating"),
    ).not.toBeInTheDocument();

    fireEvent.change(agentSelect, {
      target: { value: "cairn" },
    });

    expect(
      within(devLayer).getByText("tool call: set_creating"),
    ).toBeInTheDocument();
    expect(
      within(devLayer).queryByText("subagent tool call: read"),
    ).not.toBeInTheDocument();
  });

  test("searches dev tool events by tool name and subagent prompt details", () => {
    devLogMock.events = [
      {
        id: "spawn-subagent",
        receivedAt: "2026-05-02T12:00:01.123Z",
        payload: {
          type: "session_event",
          source: { kind: "parent", agentId: "cairn" },
          event: {
            type: "message_end",
            timestamp: "2026-05-02T12:00:01.123Z",
            message: {
              role: "assistant",
              usage: {
                input: 10,
                output: 4,
                cacheRead: 2,
                cacheWrite: 1,
              },
              content: [
                {
                  type: "toolCall",
                  name: "spawn_subagent",
                  arguments: {
                    skill_name: "implement-issue",
                    args: {
                      issuePath: "issues/01-import-screen.md",
                    },
                  },
                },
              ],
            },
          },
        },
      },
      {
        id: "write-tool",
        receivedAt: "2026-05-02T12:00:02.000Z",
        payload: {
          type: "session_event",
          source: { kind: "parent", agentId: "cairn" },
          event: {
            type: "message_end",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  name: "write",
                  arguments: { path: "src/App.tsx" },
                },
              ],
            },
          },
        },
      },
    ];

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Dev" }));
    const devLayer = screen.getByRole("region", { name: "Developer mode" });
    fireEvent.click(within(devLayer).getByRole("tab", { name: "Tools" }));

    fireEvent.change(
      within(devLayer).getByRole("searchbox", { name: "Search" }),
      {
        target: { value: "spawn_subagent 01-import" },
      },
    );

    expect(
      within(devLayer).getByText("subagent fork: spawn_subagent"),
    ).toBeInTheDocument();
    expect(
      within(devLayer).queryByText("tool call: write"),
    ).not.toBeInTheDocument();

    fireEvent.change(
      within(devLayer).getByRole("searchbox", { name: "Search" }),
      {
        target: { value: "not-a-real-tool" },
      },
    );

    expect(
      within(devLayer).getByText("No matching tool calls."),
    ).toBeInTheDocument();
  });

  test("shows tool-only dev events with expandable subagent prompt details", () => {
    devLogMock.events = [
      {
        id: "spawn-subagent",
        receivedAt: "2026-05-02T12:00:01.123Z",
        payload: {
          type: "session_event",
          source: { kind: "parent", agentId: "cairn" },
          event: {
            type: "message_end",
            timestamp: "2026-05-02T12:00:01.123Z",
            message: {
              role: "assistant",
              usage: {
                input: 10,
                output: 4,
                cacheRead: 2,
                cacheWrite: 1,
              },
              content: [
                {
                  type: "toolCall",
                  name: "spawn_subagent",
                  arguments: {
                    skill_name: "implement-issue",
                    args: {
                      issuePath: "issues/01-import-screen.md",
                    },
                    response_schema: {
                      type: "object",
                      required: ["summary"],
                    },
                  },
                },
              ],
            },
          },
        },
      },
      {
        id: "assistant-message",
        receivedAt: "2026-05-02T12:00:02.000Z",
        payload: {
          type: "session_event",
          source: { kind: "parent", agentId: "cairn" },
          event: {
            type: "message_end",
            message: {
              role: "assistant",
              usage: {
                input: 5,
                output: 3,
                cacheRead: 1,
                cacheWrite: 0,
              },
              content: [{ type: "text", text: "Plain assistant text." }],
            },
          },
        },
      },
    ];

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Dev" }));
    const devLayer = screen.getByRole("region", { name: "Developer mode" });

    fireEvent.click(within(devLayer).getByRole("tab", { name: "Tools" }));

    expect(
      within(devLayer).getByText("subagent fork: spawn_subagent"),
    ).toBeInTheDocument();
    expect(within(devLayer).getByText("New input")).toBeInTheDocument();
    expect(within(devLayer).getByText("Cache read")).toBeInTheDocument();
    expect(within(devLayer).getByText("Cache write")).toBeInTheDocument();
    expect(within(devLayer).getByText("Output")).toBeInTheDocument();
    expect(within(devLayer).getByText("15")).toBeInTheDocument();
    expect(within(devLayer).getByText("7")).toBeInTheDocument();
    expect(within(devLayer).getByText("3")).toBeInTheDocument();
    expect(within(devLayer).getByText("1")).toBeInTheDocument();
    expect(
      within(devLayer).getByText("in 10 / out 4 / cached 3"),
    ).toBeInTheDocument();
    expect(
      within(devLayer).queryByText("assistant ended"),
    ).not.toBeInTheDocument();

    const row = within(devLayer)
      .getByText("subagent fork: spawn_subagent")
      .closest("li");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText(
        (_, element) =>
          element?.tagName === "TIME" &&
          element.getAttribute("datetime") === "2026-05-02T12:00:01.123Z" &&
          /^\d{2}:\d{2}:\d{2}$/.test(element.textContent ?? ""),
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Expand event" }),
    );

    expect(within(devLayer).getByText("Subagent Prompt")).toBeInTheDocument();
    expect(within(devLayer).getByText("Token Usage")).toBeInTheDocument();
    expect(
      within(devLayer).getByText(/\/skill:implement-issue/),
    ).toBeInTheDocument();
    expect(
      within(devLayer).getAllByText(/issues\/01-import-screen\.md/).length,
    ).toBeGreaterThan(0);
    expect(
      within(devLayer).getByText("Subagent Response Schema"),
    ).toBeInTheDocument();
  });
});
