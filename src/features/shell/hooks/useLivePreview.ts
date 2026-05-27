import { useCallback, useState } from "react";

export type LivePreview = {
  url: string;
  label: string;
};

export function useLivePreview() {
  const [livePreview, setLivePreview] = useState<LivePreview | null>(null);

  const live_preview_set = useCallback((url: string, label: string) => {
    setLivePreview({ url, label });
  }, []);

  const clear = useCallback(() => {
    setLivePreview(null);
  }, []);

  const agent_end = useCallback(() => {}, []);

  return {
    livePreview,
    live_preview_set,
    agent_end,
    project_changed: clear,
    error: clear,
  };
}
