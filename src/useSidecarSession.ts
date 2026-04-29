import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { applyAssistantDelta, markAssistantDone, type ChatMessage } from "./chat-stream";

type ActiveProject = {
  id: string;
  name: string;
  path: string;
  displayName: string;
};

type SidecarEvent =
  | { type: "hydrate"; messages: ChatMessage[] }
  | { type: "active_project"; project: ActiveProject }
  | { type: "ready" }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | { type: "creating_started"; target: "brief"; message: string }
  | { type: "agent_end" }
  | { type: "error"; message: string };

type SidecarStatus = {
  ready: boolean;
  error: string | null;
  hydrate: ChatMessage[] | null;
  activeProject: ActiveProject | null;
};

type SidecarSessionHandlers = {
  onCreatingStarted: (target: "brief", message: string) => void;
  onAgentEnd: () => void;
  onHydrate: () => void;
  onError: () => void;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function newId() {
  return Math.random().toString(36).slice(2);
}

export function useSidecarSession({
  onCreatingStarted,
  onAgentEnd,
  onHydrate,
  onError,
}: SidecarSessionHandlers) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const activeAssistantId = useRef<string | null>(null);
  const hydratedFromStartupRef = useRef(false);
  const messageCountRef = useRef(0);

  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      setError("This app must be launched with Tauri, not a plain browser tab.");
      setReady(false);
      return;
    }

    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    function finalizeActive() {
      const id = activeAssistantId.current;
      if (id) {
        setMessages((prev) => markAssistantDone(prev, id));
      }
      activeAssistantId.current = null;
      setSending(false);
    }

    listen<SidecarEvent>("sidecar-event", (event) => {
      const payload = event.payload;
      switch (payload.type) {
        case "hydrate":
          onHydrate();
          activeAssistantId.current = null;
          setSending(false);
          hydratedFromStartupRef.current = true;
          setMessages(payload.messages);
          break;
        case "ready":
          setReady(true);
          setError(null);
          break;
        case "active_project":
          break;
        case "text_delta": {
          setSending(true);
          setMessages((prev) => {
            const next = applyAssistantDelta(
              prev,
              activeAssistantId.current,
              payload.delta,
              newId,
            );
            activeAssistantId.current = next.activeAssistantId;
            return next.messages;
          });
          break;
        }
        case "text_done": {
          const id = activeAssistantId.current;
          if (!id) break;
          setMessages((prev) => markAssistantDone(prev, id));
          break;
        }
        case "creating_started":
          onCreatingStarted(payload.target, payload.message);
          break;
        case "agent_end":
          onAgentEnd();
          finalizeActive();
          break;
        case "error":
          onError();
          console.error("[sidecar error]", payload.message);
          setError(payload.message);
          setReady(false);
          finalizeActive();
          break;
        default: {
          const _exhaustive: never = payload;
          console.warn("[sidecar] unhandled event", _exhaustive);
        }
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        invoke<SidecarStatus>("get_sidecar_status")
          .then((status) => {
            if (cancelled) return;
            if (
              status.hydrate &&
              !hydratedFromStartupRef.current &&
              messageCountRef.current === 0
            ) {
              hydratedFromStartupRef.current = true;
              onHydrate();
              setMessages(status.hydrate);
            }
            if (status.ready) setReady(true);
            if (status.error) setError(status.error);
          })
          .catch((err) => console.error("get_sidecar_status failed", err));
      })
      .catch((err) => {
        console.error("sidecar-event listen() failed", err);
        if (!cancelled) setError("Failed to attach to the sidecar.");
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onAgentEnd, onCreatingStarted, onError, onHydrate]);

  async function sendPrompt(text: string) {
    if (!text || sending || !ready) return;

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      done: true,
    };
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: "assistant",
      text: "",
      done: false,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    activeAssistantId.current = assistantMsg.id;
    setSending(true);

    try {
      await invoke("send_prompt", { text });
    } catch (err) {
      console.error("send_prompt failed", err);
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      activeAssistantId.current = null;
      setSending(false);
    }
  }

  return {
    messages,
    ready,
    error,
    sending,
    sendPrompt,
  };
}
