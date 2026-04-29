import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CreatingTarget = "brief";

export type CreatingIndicator = {
  target: CreatingTarget;
  message: string;
};

export type CreatingIndicatorContent = Record<CreatingTarget, string>;

type CreatingState = CreatingIndicator & {
  baselineContent: string;
};

export function useCreatingIndicator(content: CreatingIndicatorContent) {
  const [creatingState, setCreatingState] = useState<CreatingState | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const creating_started = useCallback(
    (target: CreatingTarget, message: string) => {
      setCreatingState({
        target,
        message,
        baselineContent: contentRef.current[target],
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setCreatingState(null);
  }, []);

  useEffect(() => {
    if (!creatingState) return;

    if (content[creatingState.target] !== creatingState.baselineContent) {
      setCreatingState(null);
    }
  }, [content, creatingState]);

  const creating = useMemo<CreatingIndicator | null>(() => {
    if (!creatingState) return null;
    return {
      target: creatingState.target,
      message: creatingState.message,
    };
  }, [creatingState]);

  return {
    creating,
    creating_started,
    agent_end: clear,
    hydrate: clear,
    error: clear,
  };
}
