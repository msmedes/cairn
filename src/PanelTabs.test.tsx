import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { type PanelTab, PanelTabs } from "./PanelTabs";

const tabs: PanelTab[] = [
  { key: "project", label: "Project", available: true },
  { key: "plan", label: "Plan", available: true },
  { key: "building", label: "Building", available: false },
];

describe("PanelTabs", () => {
  test("renders the active tab distinctly", () => {
    render(<PanelTabs tabs={tabs} activeKey="plan" onSelect={() => {}} />);

    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveClass("tab-active");
    expect(screen.getByRole("tab", { name: "Project" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("onSelect fires with the clicked tab key", () => {
    const onSelect = vi.fn();
    render(<PanelTabs tabs={tabs} activeKey="project" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));

    expect(onSelect).toHaveBeenCalledWith("plan");
  });

  test("unavailable tabs render disabled", () => {
    const onSelect = vi.fn();
    render(<PanelTabs tabs={tabs} activeKey="project" onSelect={onSelect} />);

    const buildingTab = screen.getByRole("tab", { name: "Building" });
    expect(buildingTab).toBeDisabled();

    fireEvent.click(buildingTab);

    expect(onSelect).not.toHaveBeenCalled();
  });
});
