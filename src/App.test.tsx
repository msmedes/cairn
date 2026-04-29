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
        case "brief.md":
          return "# Project brief\n\n## Shape\n\nThe existing brief.";
        case "brief.html":
        case "plan.html":
        case ".guide/prds":
        case ".guide/issues":
          return "";
        default:
          return "";
      }
    });
  });

  test("switches between the Project slideshow and Plan empty state", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: "Project" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTitle("Project brief slideshow")).toBeInTheDocument();

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

    expect(screen.getByTitle("Project brief slideshow")).toBeInTheDocument();
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
});
