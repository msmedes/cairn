import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useActivePanelTab } from "./useActivePanelTab";

describe("useActivePanelTab", () => {
  test("initial state with no plan is project", () => {
    const { result } = renderHook(() => useActivePanelTab(false, false));

    expect(result.current.activeTab).toBe("project");
  });

  test("first plan creation auto-switches to plan", async () => {
    const { result, rerender } = renderHook(
      ({ planExists }) => useActivePanelTab(planExists, false),
      { initialProps: { planExists: false } },
    );

    rerender({ planExists: true });

    await waitFor(() => {
      expect(result.current.activeTab).toBe("plan");
    });
  });

  test("user can click project after the first auto-switch", async () => {
    const { result, rerender } = renderHook(
      ({ planExists }) => useActivePanelTab(planExists, false),
      { initialProps: { planExists: false } },
    );

    rerender({ planExists: true });
    await waitFor(() => {
      expect(result.current.activeTab).toBe("plan");
    });

    act(() => {
      result.current.setActiveTab("project");
    });

    expect(result.current.activeTab).toBe("project");
  });

  test("regeneration after auto-switch stays where the user is", async () => {
    const { result, rerender } = renderHook(
      ({ planExists }) => useActivePanelTab(planExists, false),
      { initialProps: { planExists: false } },
    );

    rerender({ planExists: true });
    await waitFor(() => {
      expect(result.current.activeTab).toBe("plan");
    });

    act(() => {
      result.current.setActiveTab("project");
    });
    rerender({ planExists: true });

    expect(result.current.activeTab).toBe("project");
  });

  test("plan removal does not re-arm the first-creation auto-switch", async () => {
    const { result, rerender } = renderHook(
      ({ planExists }) => useActivePanelTab(planExists, false),
      { initialProps: { planExists: false } },
    );

    rerender({ planExists: true });
    await waitFor(() => {
      expect(result.current.activeTab).toBe("plan");
    });

    act(() => {
      result.current.setActiveTab("project");
    });
    rerender({ planExists: false });
    rerender({ planExists: true });

    expect(result.current.activeTab).toBe("project");
  });

  test("first tasks creation auto-switches to tasks", async () => {
    const { result, rerender } = renderHook(
      ({ tasksExists }) => useActivePanelTab(false, tasksExists),
      { initialProps: { tasksExists: false } },
    );

    rerender({ tasksExists: true });

    await waitFor(() => {
      expect(result.current.activeTab).toBe("tasks");
    });
  });

  test("tasks rewrite after auto-switch stays where the user is", async () => {
    const { result, rerender } = renderHook(
      ({ tasksExists }) => useActivePanelTab(false, tasksExists),
      { initialProps: { tasksExists: false } },
    );

    rerender({ tasksExists: true });
    await waitFor(() => {
      expect(result.current.activeTab).toBe("tasks");
    });

    act(() => {
      result.current.setActiveTab("project");
    });
    rerender({ tasksExists: true });

    expect(result.current.activeTab).toBe("project");
  });
});
