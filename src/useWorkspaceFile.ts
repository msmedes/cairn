import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useWorkspaceFile(name: string, intervalMs = 1000): string {
  const [content, setContent] = useState("");
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      setContent("");
      return;
    }

    let cancelled = false;

    async function poll() {
      if (pollingRef.current) return;
      pollingRef.current = true;

      try {
        const next = await invoke<string>("read_workspace_file", { name });
        if (!cancelled) {
          setContent((prev) => (prev === next ? prev : next));
        }
      } catch (err) {
        if (!cancelled) {
          console.error("read_workspace_file failed", err);
        }
      } finally {
        pollingRef.current = false;
      }
    }

    void poll();
    const timer = window.setInterval(poll, Math.max(intervalMs, 250));

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs, name]);

  return content;
}
