import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useLivePreview } from "./useLivePreview";

describe("useLivePreview", () => {
  test("set from null shows the chip", () => {
    const { result } = renderHook(() => useLivePreview());

    act(() => {
      result.current.live_preview_set(
        "http://localhost:5173",
        "Your recipe finder",
      );
    });

    expect(result.current.livePreview).toEqual({
      url: "http://localhost:5173",
      label: "Your recipe finder",
    });
  });

  test("set from non-null replaces the current chip", () => {
    const { result } = renderHook(() => useLivePreview());

    act(() => {
      result.current.live_preview_set(
        "http://localhost:5173",
        "Your recipe finder",
      );
      result.current.live_preview_set(
        "http://localhost:4173",
        "Your meal planner",
      );
    });

    expect(result.current.livePreview).toEqual({
      url: "http://localhost:4173",
      label: "Your meal planner",
    });
  });

  test("project_changed clears the chip", () => {
    const { result } = renderHook(() => useLivePreview());

    act(() => {
      result.current.live_preview_set(
        "http://localhost:5173",
        "Your recipe finder",
      );
      result.current.project_changed();
    });

    expect(result.current.livePreview).toBeNull();
  });

  test("error clears the chip", () => {
    const { result } = renderHook(() => useLivePreview());

    act(() => {
      result.current.live_preview_set(
        "http://localhost:5173",
        "Your recipe finder",
      );
      result.current.error();
    });

    expect(result.current.livePreview).toBeNull();
  });

  test("agent_end does not clear the chip", () => {
    const { result } = renderHook(() => useLivePreview());

    act(() => {
      result.current.live_preview_set(
        "http://localhost:5173",
        "Your recipe finder",
      );
      result.current.agent_end();
    });

    expect(result.current.livePreview).toEqual({
      url: "http://localhost:5173",
      label: "Your recipe finder",
    });
  });
});
