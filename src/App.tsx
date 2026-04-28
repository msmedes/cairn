import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";

type SidecarEvent =
  | { type: "ready" }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | { type: "agent_end" }
  | { type: "error"; message: string };

type SidecarStatus = {
  ready: boolean;
  error: string | null;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function newId() {
  return Math.random().toString(36).slice(2);
}

const MAX_INPUT_HEIGHT = 220;

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Track the in-flight assistant message so streamed deltas land in the right place.
  const activeAssistantId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
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

  // Auto-scroll on new content.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    resizeInput();
  }, [input]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      resizeInput();
    });
    observer.observe(composer);

    return () => observer.disconnect();
  }, []);

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
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, done: true } : m)),
        );
      }
      activeAssistantId.current = null;
      setSending(false);
    }

    listen<SidecarEvent>("sidecar-event", (event) => {
      const payload = event.payload;
      switch (payload.type) {
        case "ready":
          setReady(true);
          setError(null);
          break;
        case "text_delta": {
          const id = activeAssistantId.current;
          if (!id) break;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, text: m.text + payload.delta } : m,
            ),
          );
          break;
        }
        case "text_done": {
          const id = activeAssistantId.current;
          if (!id) break;
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, done: true } : m)),
          );
          break;
        }
        case "agent_end":
          finalizeActive();
          break;
        case "error":
          console.error("[sidecar error]", payload.message);
          setError(payload.message);
          setReady(false);
          finalizeActive();
          break;
        default: {
          // Compile-time exhaustiveness: a new variant in SidecarEvent must
          // add a case here or the build fails.
          const _exhaustive: never = payload;
          console.warn("[sidecar] unhandled event", _exhaustive);
        }
      }
    })
      .then((fn) => {
        // If the effect was already torn down (StrictMode dev double-mount,
        // HMR, etc.), unsubscribe immediately so we don't leak a duplicate.
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        // Listener is live now — query current state in case ready/error
        // already happened before we subscribed.
        invoke<SidecarStatus>("get_sidecar_status")
          .then((status) => {
            if (cancelled) return;
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
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || sending || !ready) return;

    const userMsg: Message = {
      id: newId(),
      role: "user",
      text,
      done: true,
    };
    const assistantMsg: Message = {
      id: newId(),
      role: "assistant",
      text: "",
      done: false,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    activeAssistantId.current = assistantMsg.id;
    setInput("");
    setSending(true);

    try {
      await invoke("send_prompt", { text });
    } catch (err) {
      console.error("send_prompt failed", err);
      // Drop the orphaned assistant message; the user message stays visible.
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      activeAssistantId.current = null;
      setSending(false);
    }
  }

  const statusLabel = error ? "error" : ready ? "ready" : "starting…";
  const statusClass = error ? "err" : ready ? "ok" : "wait";

  return (
    <main className="app">
      <section className="chat">
        <header className="chat-header">
          <div className="brand">
            <h1>Guide</h1>
          </div>
          <span className={`status ${statusClass}`} title={error ?? undefined}>
            {statusLabel}
          </span>
        </header>

        <div
          className="messages"
          ref={listRef}
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className="empty">
              <p className="empty-kicker">Start with the rough version.</p>
              <p>Tell me what you want this thing to do for people.</p>
              <p className="hint">A quiz for work. A helper for your group. A tiny tool that saves time.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg-row msg-row-${m.role}`}>
              <div className={`msg msg-${m.role}`}>
                {m.text || (m.role === "assistant" && !m.done ? "…" : "")}
              </div>
            </div>
          ))}
        </div>

        <form
          ref={composerRef}
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={inputRef}
            placeholder={ready ? "Type a message…" : "Waking up…"}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!ready || sending}
            aria-label="Message"
            rows={1}
          />
          <button type="submit" disabled={!ready || sending || !input.trim()}>
            Send
          </button>
        </form>
      </section>

      <aside className="panel">
        <div className="panel-tabs">
          <span className="tab tab-active">Project</span>
        </div>
        <div className="panel-body">
          <section className="panel-placeholder">
            <p className="panel-kicker">Working draft</p>
            <h2>Your project brief will take shape here.</h2>
            <p className="panel-empty">
              As the conversation sharpens, this panel will turn your answers into a short readable plan.
            </p>
            <div className="panel-ghost">
              <div className="ghost-line ghost-line-title" />
              <div className="ghost-line ghost-line-wide" />
              <div className="ghost-line ghost-line-mid" />
              <div className="ghost-line ghost-line-wide" />
              <div className="ghost-line ghost-line-short" />
            </div>
          </section>
        </div>
      </aside>
    </main>
  );
}

export default App;
