import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useCreatingIndicator } from "./useCreatingIndicator";

describe("useCreatingIndicator", () => {
  test("initial state is null", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "" }),
    );

    expect(result.current.creating).toBeNull();
  });

  test("creating_started sets the current creating state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "" }),
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
      ({ brief }) => useCreatingIndicator({ brief }),
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
      ({ brief }) => useCreatingIndicator({ brief }),
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
      ({ brief }) => useCreatingIndicator({ brief }),
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
      useCreatingIndicator({ brief: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.agent_end();
    });

    expect(result.current.creating).toBeNull();
  });

  test("hydrate mid-creating clears state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.hydrate();
    });

    expect(result.current.creating).toBeNull();
  });

  test("error mid-creating clears state", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "" }),
    );

    act(() => {
      result.current.creating_started("brief", "Writing the brief");
      result.current.error();
    });

    expect(result.current.creating).toBeNull();
  });

  test("two creating_started calls in sequence use the second one", () => {
    const { result } = renderHook(() =>
      useCreatingIndicator({ brief: "" }),
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
});
