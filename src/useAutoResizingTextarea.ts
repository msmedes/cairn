import { useEffect, useLayoutEffect, useRef } from "react";

const MAX_INPUT_HEIGHT = 220;

export function useAutoResizingTextarea(value: string) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  function resizeInput() {
    const el = inputRef.current;
    if (!el) return;

    // Reset first so both wrapping changes and deleted text can shrink the field.
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }

  useLayoutEffect(() => {
    resizeInput();
  }, [value]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      resizeInput();
    });
    observer.observe(composer);

    return () => observer.disconnect();
  }, []);

  return { composerRef, inputRef };
}
