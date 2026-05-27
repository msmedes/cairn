import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useProjectFile } from "../features/project/hooks/useProjectFile";
import type { CreatingTarget } from "../features/shell/hooks/useCreatingIndicator";
import App from "./App";

const devLogMock = vi.hoisted(() => ({
  events: [] as Array<{
    id: string;
    receivedAt: string;
    payload: unknown;
  }>,
}));
const invokeMock = vi.hoisted(() => vi.fn());
const getVersionMock = vi.hoisted(() => vi.fn());
const openUrlMock = vi.hoisted(() => vi.fn());
const sendPromptMock = vi.hoisted(() => vi.fn());
const authenticateMcpServerMock = vi.hoisted(() => vi.fn());
const menuEventHandlers = vi.hoisted(
  () => [] as Array<(event: { payload: string }) => void>,
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    eventName: string,
    handler: (event: { payload: string }) => void,
  ) => {
    if (eventName === "menu-event") {
      menuEventHandlers.push(handler);
    }
    return () => {
      const idx = menuEventHandlers.indexOf(handler);
      if (idx >= 0) menuEventHandlers.splice(idx, 1);
    };
  },
}));

function fireMenuEvent(payload: string) {
  for (const handler of menuEventHandlers.slice()) {
    handler({ payload });
  }
}

function bootstrapTauriRuntime() {
  (
    window as typeof window & { __TAURI_INTERNALS__?: unknown }
  ).__TAURI_INTERNALS__ = {};
  invokeMock.mockImplementation(() => Promise.resolve(null));
  getVersionMock.mockResolvedValue("test");
  openUrlMock.mockResolvedValue(undefined);
}

async function openDevPanelViaMenu() {
  await act(async () => {});
  act(() => {
    fireMenuEvent("dev-panel");
  });
}

vi.mock("../features/project/hooks/useProjectFile", () => ({
  useProjectFile: vi.fn(),
}));

vi.mock("../features/dev-mode/useSidecarDevLog", () => ({
  useSidecarDevLog: () => ({
    events: devLogMock.events,
    clearEvents: vi.fn(),
  }),
}));

type SidecarSessionHandlers = {
  onCreatingStarted: (target: CreatingTarget, message: string) => void;
  onLivePreviewSet: (url: string, label: string) => void;
  onAgentEnd: () => void;
  onHydrate: () => void;
  onError: () => void;
  onMcpAuthStatus?: (event: {
    type: "mcp_auth_status";
    server: string;
    status: "started" | "authenticated" | "failed";
    message: string;
  }) => void;
};

let sidecarSessionHandlers: SidecarSessionHandlers | null = null;
let mockMessages: Array<{
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
  images?: Array<{ dataUrl: string; mimeType: string }>;
}> = [];
let mockRecents: Array<{
  path: string;
  displayName: string;
  lastOpenedAt: string;
}> = [];
let mockActiveProject: {
  id: string;
  name: string;
  path: string;
  displayName: string;
} | null = null;
const openProjectMock = vi.hoisted(() => vi.fn());
const openProjectDialogMock = vi.hoisted(() => vi.fn());

vi.mock("../features/chat/hooks/useSidecarSession", () => ({
  useSidecarSession: (handlers: SidecarSessionHandlers) => {
    sidecarSessionHandlers = handlers;

    return {
      messages: mockMessages,
      recents: mockRecents,
      projectOpenError: null,
      activeProject: mockActiveProject,
      pendingQuestion: null,
      submittingQuestion: false,
      ready: true,
      error: null,
      sending: false,
      sendPrompt: sendPromptMock,
      authenticateMcpServer: authenticateMcpServerMock,
      openProject: openProjectMock,
      openProjectDialog: openProjectDialogMock,
    };
  },
}));

const mockUseProjectFile = vi.mocked(useProjectFile);

describe("App panel tabs", () => {
  beforeEach(() => {
    sidecarSessionHandlers = null;
    mockMessages = [];
    mockRecents = [];
    mockActiveProject = null;
    openProjectMock.mockReset();
    openProjectDialogMock.mockReset();
    sendPromptMock.mockReset();
    authenticateMcpServerMock.mockReset();
    invokeMock.mockReset();
    getVersionMock.mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    menuEventHandlers.length = 0;
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

  test("queues a dropped image and sends it without text", async () => {
    render(<App />);

    const textarea = screen.getByLabelText("Message");
    const image = new File([new Uint8Array([1, 2, 3])], "screen.png", {
      type: "image/png",
    });

    fireEvent.drop(textarea, {
      dataTransfer: {
        files: [image],
      },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove image/png attachment" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(sendPromptMock).toHaveBeenCalledWith("", [
        expect.objectContaining({
          data: "AQID",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AQID",
        }),
      ]);
    });
    expect(
      screen.queryByRole("button", { name: "Remove image/png attachment" }),
    ).not.toBeInTheDocument();
  });

  test("rejects dropped non-image files without queueing them", async () => {
    render(<App />);

    const textarea = screen.getByLabelText("Message");
    const pdf = new File([new Uint8Array([1])], "brief.pdf", {
      type: "application/pdf",
    });

    fireEvent.drop(textarea, {
      dataTransfer: {
        files: [pdf],
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "brief.pdf: Only PNG, JPEG, WebP, and GIF images can be attached.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
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

  test("Settings overlay surfaces API key and MCP controls", async () => {
    bootstrapTauriRuntime();
    render(<App />);
    await act(async () => {});
    act(() => {
      fireMenuEvent("settings");
    });

    expect(
      screen.getByRole("dialog", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Anthropic" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MCP" })).toBeInTheDocument();
    expect(screen.getByText("Notion")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "API key" }),
    ).not.toBeInTheDocument();
  });

  test("native Report a Bug menu event opens the bug report dialog", async () => {
    bootstrapTauriRuntime();
    render(<App />);
    await act(async () => {});

    act(() => {
      fireMenuEvent("report-bug");
    });

    expect(
      screen.getByRole("dialog", { name: "Report a bug" }),
    ).toBeInTheDocument();
  });

  test("native Cairn repo menu event opens the repository URL", async () => {
    bootstrapTauriRuntime();
    render(<App />);
    await act(async () => {});

    act(() => {
      fireMenuEvent("cairn-repo");
    });

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/msmedes/cairn",
    );
  });

  test("live preview chip opens the latest declared URL and survives post-prompt hydrate", async () => {
    bootstrapTauriRuntime();
    render(<App />);

    act(() => {
      sidecarSessionHandlers?.onLivePreviewSet(
        "http://localhost:5173",
        "Your recipe finder",
      );
    });

    const chip = screen.getByRole("button", { name: "Your recipe finder" });
    expect(chip).toHaveAttribute("title", "http://localhost:5173");

    fireEvent.click(chip);

    expect(openUrlMock).toHaveBeenCalledWith("http://localhost:5173");

    act(() => {
      sidecarSessionHandlers?.onLivePreviewSet(
        "http://localhost:4173",
        "Your meal planner",
      );
    });

    expect(
      screen.queryByRole("button", { name: "Your recipe finder" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Your meal planner" }),
    ).toHaveAttribute("title", "http://localhost:4173");

    act(() => {
      sidecarSessionHandlers?.onHydrate();
    });

    expect(
      screen.getByRole("button", { name: "Your meal planner" }),
    ).toBeInTheDocument();
  });

  test("live preview chip clears when the active project changes", async () => {
    bootstrapTauriRuntime();
    mockActiveProject = {
      id: "project-1",
      name: "first",
      path: "/tmp/first-project",
      displayName: "First Project",
    };
    const { rerender } = render(<App />);

    act(() => {
      sidecarSessionHandlers?.onLivePreviewSet(
        "http://localhost:5173",
        "Your recipe finder",
      );
    });

    expect(
      screen.getByRole("button", { name: "Your recipe finder" }),
    ).toBeInTheDocument();

    mockActiveProject = {
      id: "project-2",
      name: "second",
      path: "/tmp/second-project",
      displayName: "Second Project",
    };
    rerender(<App />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Your recipe finder" }),
      ).not.toBeInTheDocument();
    });
  });

  test("live preview chip clears when there is no active project", async () => {
    bootstrapTauriRuntime();
    mockActiveProject = {
      id: "project-1",
      name: "first",
      path: "/tmp/first-project",
      displayName: "First Project",
    };
    const { rerender } = render(<App />);

    act(() => {
      sidecarSessionHandlers?.onLivePreviewSet(
        "http://localhost:5173",
        "Your recipe finder",
      );
    });

    expect(
      screen.getByRole("button", { name: "Your recipe finder" }),
    ).toBeInTheDocument();

    mockActiveProject = null;
    rerender(<App />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Your recipe finder" }),
      ).not.toBeInTheDocument();
    });
  });

  test("bug report submission uses the current menu-event snapshot", async () => {
    bootstrapTauriRuntime();
    mockMessages = [
      {
        id: "m1",
        role: "user",
        text: "it broke",
        done: true,
      },
    ];
    devLogMock.events = [
      {
        id: "event-1",
        receivedAt: "2026-05-01T12:00:00.000Z",
        payload: { type: "tool", value: "ran" },
      },
    ];
    mockActiveProject = {
      id: "project-1",
      name: "demo",
      path: "/tmp/demo",
      displayName: "Demo Project",
    };
    render(<App />);
    await act(async () => {});

    act(() => {
      fireMenuEvent("report-bug");
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Bad state" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The app did a weird thing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "bug_report_bundler",
        expect.any(Object),
      );
    });
    const bugReportCall = invokeMock.mock.calls.find(
      ([command]) => command === "bug_report_bundler",
    );
    expect(bugReportCall).toBeDefined();
    const payload = bugReportCall?.[1] as {
      projectPath: string | null;
      devEventsJson: string;
      metaJson: string;
      githubUrl: string;
    };
    expect(payload.projectPath).toBe("/tmp/demo");
    expect(JSON.parse(payload.devEventsJson)).toMatchObject({
      messages: [{ id: "m1", text: "it broke" }],
      devEvents: [{ id: "event-1", payload: { type: "tool", value: "ran" } }],
    });
    expect(JSON.parse(payload.metaJson)).toMatchObject({
      activeProjectName: "Demo Project",
      title: "Bad state",
      description: "The app did a weird thing.",
    });
    expect(decodeURIComponent(payload.githubUrl)).toContain("Bad state");
  });

  test("Settings overlay behaves like a modal dialog", async () => {
    bootstrapTauriRuntime();
    render(<App />);
    await act(async () => {});

    const statusButton = screen.getByRole("button", { name: /Status:/ });
    statusButton.focus();
    expect(statusButton).toHaveFocus();

    act(() => {
      fireMenuEvent("settings");
    });

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Close" })).toHaveFocus(),
    );
    expect(screen.getByText("Cairn").closest("section")).toHaveAttribute(
      "inert",
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(statusButton).toHaveFocus();
  });

  test("Settings tab saves API keys and toggles built-in MCP servers", async () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case "get_cairn_settings":
          return Promise.resolve({ hasAnthropicApiKey: false });
        case "get_mcp_settings":
          return Promise.resolve({
            configPath: "/Users/mike/.pi/agent/mcp.json",
            notionEnabled: false,
            notionManaged: false,
            notionSource: null,
            slackEnabled: false,
            slackManaged: false,
            slackSource: null,
          });
        case "set_anthropic_api_key":
          return Promise.resolve({ hasAnthropicApiKey: true });
        case "set_mcp_server_enabled":
          expect(args).toEqual({ server: "notion", enabled: true });
          return Promise.resolve({
            configPath: "/Users/mike/.pi/agent/mcp.json",
            notionEnabled: true,
            notionManaged: true,
            notionSource: "Pi global",
            slackEnabled: false,
            slackManaged: false,
            slackSource: null,
          });
        default:
          return Promise.resolve(null);
      }
    });
    getVersionMock.mockResolvedValue("0.1.0");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-ant-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(invokeMock).toHaveBeenCalledWith("set_anthropic_api_key", {
      apiKey: "sk-ant-test",
    });
    expect(
      await screen.findByRole("button", { name: "Replace" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(invokeMock).toHaveBeenCalledWith("set_mcp_server_enabled", {
      server: "notion",
      enabled: true,
    });
    expect(await screen.findByText("MCP server added.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Authenticate" })[0]);
    expect(authenticateMcpServerMock).toHaveBeenCalledWith("notion");
    expect(sendPromptMock).not.toHaveBeenCalledWith("/mcp-auth notion");
  });

  test("clearing a replacement API key draft keeps the replace form open", async () => {
    bootstrapTauriRuntime();
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_cairn_settings":
          return Promise.resolve({ hasAnthropicApiKey: true });
        case "get_mcp_settings":
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
    });

    render(<App />);
    await act(async () => {});
    act(() => {
      fireMenuEvent("settings");
    });

    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    const input = screen.getByLabelText("API key");
    fireEvent.change(input, { target: { value: "sk-ant-draft" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("Settings tab does not let Cairn remove externally configured MCP servers", async () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_cairn_settings":
          return Promise.resolve({ hasAnthropicApiKey: true });
        case "get_mcp_settings":
          return Promise.resolve({
            configPath: "/Users/mike/.pi/agent/mcp.json",
            notionEnabled: true,
            notionManaged: false,
            notionSource: "project MCP",
            slackEnabled: false,
            slackManaged: false,
            slackSource: null,
          });
        default:
          return Promise.resolve(null);
      }
    });
    getVersionMock.mockResolvedValue("0.1.0");

    render(<App />);
    await act(async () => {});
    act(() => {
      fireMenuEvent("settings");
    });

    expect(await screen.findByText("External")).toBeInTheDocument();
    expect(screen.getByText(/configured in project MCP/)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Authenticate" })[0]);
    expect(authenticateMcpServerMock).toHaveBeenCalledWith("notion");
  });

  test("empty chat state shows recents and opens a selected project", () => {
    mockUseProjectFile.mockImplementation(() => "");
    mockRecents = [
      {
        path: "/Users/mike/code/quiz",
        displayName: "Training Quiz",
        lastOpenedAt: "2026-05-01T12:00:00.000Z",
      },
      {
        path: "/Users/mike/code/forms",
        displayName: "Forms Tool",
        lastOpenedAt: "2026-05-01T11:00:00.000Z",
      },
    ];

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Training Quiz" }));

    expect(screen.getByText("/Users/mike/code/quiz")).toBeInTheDocument();
    expect(openProjectMock).toHaveBeenCalledWith("/Users/mike/code/quiz");
  });

  test("empty chat state exposes Open Folder action", () => {
    mockUseProjectFile.mockImplementation(() => "");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open Folder…" }));

    expect(openProjectDialogMock).toHaveBeenCalledTimes(1);
  });

  test("opens a dev mode layer with visible chat messages and event counts", async () => {
    devLogMock.events = [
      {
        id: "session-location",
        receivedAt: "2026-05-02T12:00:00.000Z",
        payload: {
          type: "session_location",
          sessionFile:
            "/Users/mike/draupnir/.cairn/sessions/2026-05-02_chat.jsonl",
          sessionDir: "/Users/mike/draupnir/.cairn/sessions",
          projectPath: "/Users/mike/draupnir",
        },
      },
    ];
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

    bootstrapTauriRuntime();
    render(<App />);
    await openDevPanelViaMenu();

    const devLayer = screen.getByRole("dialog", { name: "Session Debug" });
    expect(devLayer).toBeInTheDocument();
    expect(devLayer).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Session Debug")).toBeInTheDocument();
    expect(screen.getByText("Chat JSONL")).toBeInTheDocument();
    expect(
      screen.getByText(
        "/Users/mike/draupnir/.cairn/sessions/2026-05-02_chat.jsonl",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(
      within(devLayer).getByText("Build a small quiz helper."),
    ).toBeInTheDocument();
    expect(
      within(devLayer).getByText("I'll ask one scoping question."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(within(devLayer).getByText("session_location")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Session Debug" }),
    ).not.toBeInTheDocument();
  });

  test("does not render completed assistant turns with no text", () => {
    mockMessages = [
      {
        id: "user-1",
        role: "user",
        text: "now?",
        done: true,
      },
      {
        id: "tool-only-assistant",
        role: "assistant",
        text: "",
        done: true,
      },
      {
        id: "pending-assistant",
        role: "assistant",
        text: "",
        done: false,
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "Got it — I'm in.",
        done: true,
      },
    ];

    const { container } = render(<App />);

    expect(screen.getByText("now?")).toBeInTheDocument();
    expect(screen.getByText("Got it — I'm in.")).toBeInTheDocument();
    expect(screen.getByLabelText("Cairn is working")).toBeInTheDocument();
    expect(container.querySelectorAll(".msg-assistant")).toHaveLength(2);
  });

  test("filters dev events by agent thread", async () => {
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

    bootstrapTauriRuntime();
    render(<App />);
    await openDevPanelViaMenu();
    const devLayer = screen.getByRole("dialog", { name: "Session Debug" });

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

  test("searches dev tool events by tool name and subagent prompt details", async () => {
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

    bootstrapTauriRuntime();
    render(<App />);
    await openDevPanelViaMenu();
    const devLayer = screen.getByRole("dialog", { name: "Session Debug" });
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

  test("shows tool-only dev events with expandable subagent prompt details", async () => {
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

    bootstrapTauriRuntime();
    render(<App />);
    await openDevPanelViaMenu();
    const devLayer = screen.getByRole("dialog", { name: "Session Debug" });

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
