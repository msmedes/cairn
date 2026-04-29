import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useCreatingIndicator } from "./useCreatingIndicator";

describe("useCreatingIndicator", () => {
  test("initial state is null", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    expect(result.current.creating).toBeNull();
  });

  test("creating_started sets the current creating state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Putting your plan together");
    });

    expect(result.current.creating).toEqual({
      target: "brief",
      message: "Putting your plan together",
    });
  });

  test("unchanged target content after creating_started keeps state", () => {
    const { result, rerender } = renderHook(
      ({ brief }) => useCreatingIndicator({ brief, prd: "", issues: "" }),
      { initialProps: { brief: "draft" } },
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
    });
    rerender({ brief: "draft" });

    expect(result.current.creating).toEqual({
      target: "brief",
      message: "Writing the brief",
    });
  });

  test("target content change after creating_started clears state", async () => {
    const { result, rerender } = renderHook(
      ({ brief }) => useCreatingIndicator({ brief, prd: "", issues: "" }),
      { initialProps: { brief: "draft" } },
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
    });
    rerender({ brief: "finished" });

    await waitFor(() => {
      expect(result.current.creating).toBeNull();
    });
  });

  test("target content change before creating_started does not create or clear state", () => {
    const { result, rerender } = renderHook(
      ({ brief }) => useCreatingIndicator({ brief, prd: "", issues: "" }),
      { initialProps: { brief: "" } },
    );

    rerender({ brief: "pre-existing content" });

    expect(result.current.creating).toBeNull();

    act(() => {
      result.current.creating_started("brief", "Writing from existing content");
    });
    rerender({ brief: "pre-existing content" });

    expect(result.current.creating).toEqual({
      target: "brief",
      message: "Writing from existing content",
    });
  });

  test("agent_end after creating_started with no file change clears state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.agent_end();
    });

    expect(result.current.creating).toBeNull();
  });

  test("hydrate mid-creating clears state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.hydrate();
    });

    expect(result.current.creating).toBeNull();
  });

  test("error mid-creating clears state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.error();
    });

    expect(result.current.creating).toBeNull();
  });

  test("two creating_started calls in sequence use the second one", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "First message");
      result.current.creating_started("brief", "Second message");
    });

    expect(result.current.creating).toEqual({
      target: "brief",
      message: "Second message",
    });
  });

  test.each([
    {
      target: "prd" as const,
      contentKey: "prd" as const,
      nextContent: "01-first-slice.md",
    },
    {
      target: "issues" as const,
      contentKey: "issues" as const,
      nextContent: "01-first-issue.md",
    },
  ])("$target clears when matching guide artifact appears", async (entry) => {
    const { result, rerender } = renderHook(
      (content) => useCreatingIndicator(content),
      { initialProps: { brief: "", prd: "", issues: "" } },
    );

    act(() => {
      result.current.creating_started(entry.target, "Putting this together");
    });
    rerender({
      brief: "",
      prd: entry.contentKey === "prd" ? entry.nextContent : "",
      issues: entry.contentKey === "issues" ? entry.nextContent : "",
    });

    await waitFor(() => {
      expect(result.current.creating).toBeNull();
    });
  });

  test("mixed-target overlap replacement uses the latest target", async () => {
    const { result, rerender } = renderHook(
      (content) => useCreatingIndicator(content),
      { initialProps: { brief: "", prd: "", issues: "" } },
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.creating_started("prd", "Writing the PRD");
    });
    rerender({ brief: "done", prd: "", issues: "" });

    expect(result.current.creating).toEqual({
      target: "prd",
      message: "Writing the PRD",
    });

    act(() => {
      result.current.creating_started("issues", "Writing the issues");
    });
    rerender({ brief: "done", prd: "01-slice.md", issues: "" });

    expect(result.current.creating).toEqual({
      target: "issues",
      message: "Writing the issues",
    });

    rerender({ brief: "done", prd: "01-slice.md", issues: "01-task.md" });

    await waitFor(() => {
      expect(result.current.creating).toBeNull();
    });
  });

  test.each([
    "prd",
    "issues",
  ] as const)("agent_end clears abandoned %s creation", (target) => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "", prd: "", issues: "" }),
    );

    act(() => {
      result.current.creating_started(target, "Putting this together");
      result.current.agent_end();
    });

    expect(result.current.creating).toBeNull();
  });
});
