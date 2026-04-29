import { useEffect, useRef, useState } from "react";

export const DEFAULT_CHAT_PANE_PERCENT = 41;
export const MIN_CHAT_PANE_PERCENT = 28;
export const MAX_CHAT_PANE_PERCENT = 62;

const PANE_SPLIT_STORAGE_KEY = "guide-pane-split";

function clampPaneSplit(value: number) {
  return Math.min(
    MAX_CHAT_PANE_PERCENT,
    Math.max(MIN_CHAT_PANE_PERCENT, value),
  );
}

function readStoredPaneSplit() {
  if (typeof window === "undefined") return DEFAULT_CHAT_PANE_PERCENT;

  const stored = window.localStorage.getItem(PANE_SPLIT_STORAGE_KEY);
  if (!stored) return DEFAULT_CHAT_PANE_PERCENT;

  const parsed = Number(stored);
  return Number.isFinite(parsed)
    ? clampPaneSplit(parsed)
    : DEFAULT_CHAT_PANE_PERCENT;
}

export function usePaneSplit() {
  const appRef = useRef<HTMLElement | null>(null);
  const resizingRef = useRef(false);
  const [chatPanePercent, setChatPanePercent] = useState(readStoredPaneSplit);
  const [isResizing, setIsResizing] = useState(false);

  function setClampedChatPanePercent(
    value: number | ((previous: number) => number),
  ) {
    setChatPanePercent((previous) => {
      const next = typeof value === "function" ? value(previous) : value;
      return clampPaneSplit(next);
    });
  }

  function updatePaneSplit(clientX: number) {
    const el = appRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;

    const next = ((clientX - rect.left) / rect.width) * 100;
    setClampedChatPanePercent(next);
  }

  function startResizing(clientX: number) {
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    updatePaneSplit(clientX);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      PANE_SPLIT_STORAGE_KEY,
      String(chatPanePercent),
    );
  }, [chatPanePercent]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!resizingRef.current) return;

      const el = appRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;

      const next = ((event.clientX - rect.left) / rect.width) * 100;
      setChatPanePercent(clampPaneSplit(next));
    }

    function handlePointerUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      handlePointerUp();
    };
  }, []);

  return {
    appRef,
    chatPanePercent,
    isResizing,
    setChatPanePercent: setClampedChatPanePercent,
    startResizing,
  };
}
