import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";
import type { CreatingTarget } from "./useCreatingIndicator";
import { useProjectFile } from "./useProjectFile";

vi.mock("./useProjectFile", () => ({
  useProjectFile: vi.fn(),
}));

type SidecarSessionHandlers = {
  onCreatingStarted: (target: CreatingTarget, message: string) => void;
  onAgentEnd: () => void;
  onHydrate: () => void;
  onError: () => void;
};

let sidecarSessionHandlers: SidecarSessionHandlers | null = null;

vi.mock("./useSidecarSession", () => ({
  useSidecarSession: (handlers: SidecarSessionHandlers) => {
    sidecarSessionHandlers = handlers;

    return {
      messages: [],
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
});
