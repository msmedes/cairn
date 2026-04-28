import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";
import { buildSlidesDocument } from "./projectSlides";
import { useProjectFile } from "./useProjectFile";

type SidecarEvent =
  | { type: "hydrate"; messages: Message[] }
  | { type: "ready" }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | { type: "agent_end" }
  | { type: "error"; message: string };

type SidecarStatus = {
  ready: boolean;
  error: string | null;
  hydrate: Message[] | null;
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
const DEFAULT_CHAT_PANE_PERCENT = 41;
const MIN_CHAT_PANE_PERCENT = 28;
const MAX_CHAT_PANE_PERCENT = 62;
const PANE_SPLIT_STORAGE_KEY = "guide-pane-split";

function clampPaneSplit(value: number) {
  return Math.min(MAX_CHAT_PANE_PERCENT, Math.max(MIN_CHAT_PANE_PERCENT, value));
}

function htmlToMarkdown(html: string): string {
  if (
    typeof window === "undefined" ||
    typeof window.DOMParser === "undefined" ||
    !html.trim()
  ) {
    return "";
  }

  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const blocks = Array.from(
    doc.body.querySelectorAll("h1, h2, h3, h4, p, li"),
  );

  return blocks
    .map((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!text) return "";

      switch (node.tagName.toLowerCase()) {
        case "h1":
          return `# ${text}`;
        case "h2":
          return `## ${text}`;
        case "h3":
          return `### ${text}`;
        case "h4":
          return `#### ${text}`;
        case "li":
          return `- ${text}`;
        default:
          return text;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [chatPanePercent, setChatPanePercent] = useState(DEFAULT_CHAT_PANE_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const projectSlidesHtml = useProjectFile("brief.html");
  const projectBriefMarkdown = useProjectFile("brief.md");
  const hasProjectSlidesHtml = projectSlidesHtml.trim().length > 0;
  const hasProjectBriefMarkdown = projectBriefMarkdown.trim().length > 0;
  const normalizedProjectBrief = hasProjectBriefMarkdown
    ? projectBriefMarkdown
    : hasProjectSlidesHtml
      ? htmlToMarkdown(projectSlidesHtml)
      : "";
  const projectSlidesDoc = normalizedProjectBrief
    ? buildSlidesDocument(normalizedProjectBrief)
    : "";

  // Track the in-flight assistant message so streamed deltas land in the right place.
  const activeAssistantId = useRef<string | null>(null);
  const appRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const resizingRef = useRef(false);
  const hydratedFromStartupRef = useRef(false);
  const messageCountRef = useRef(0);

  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

  function updatePaneSplit(clientX: number) {
    const el = appRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;

    const next = ((clientX - rect.left) / rect.width) * 100;
    setChatPanePercent(clampPaneSplit(next));
  }

  function stopResizing() {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function startResizing(clientX: number) {
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    updatePaneSplit(clientX);
  }

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
    if (typeof window === "undefined") return;

    const stored = window.localStorage.getItem(PANE_SPLIT_STORAGE_KEY);
    if (!stored) return;

    const parsed = Number(stored);
    if (!Number.isFinite(parsed)) return;
    setChatPanePercent(clampPaneSplit(parsed));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PANE_SPLIT_STORAGE_KEY, String(chatPanePercent));
  }, [chatPanePercent]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!resizingRef.current) return;
      updatePaneSplit(event.clientX);
    }

    function handlePointerUp() {
      stopResizing();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      stopResizing();
    };
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
        case "hydrate":
          activeAssistantId.current = null;
          setSending(false);
          hydratedFromStartupRef.current = true;
          setMessages(payload.messages);
          break;
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
            if (
              status.hydrate &&
              !hydratedFromStartupRef.current &&
              messageCountRef.current === 0
            ) {
              hydratedFromStartupRef.current = true;
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
  const appStyle: CSSProperties = {
    ["--chat-pane" as string]: `${chatPanePercent}%`,
    ["--project-pane" as string]: `${100 - chatPanePercent}%`,
  };

  return (
    <main
      ref={appRef}
      className={`app${isResizing ? " app-resizing" : ""}`}
      style={appStyle}
    >
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

      <div
        className="pane-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat and project panels"
        tabIndex={0}
        onDoubleClick={() => setChatPanePercent(DEFAULT_CHAT_PANE_PERCENT)}
        onPointerDown={(event) => {
          event.preventDefault();
          startResizing(event.clientX);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setChatPanePercent((prev) => clampPaneSplit(prev - 3));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setChatPanePercent((prev) => clampPaneSplit(prev + 3));
          } else if (event.key === "Home") {
            event.preventDefault();
            setChatPanePercent(MIN_CHAT_PANE_PERCENT);
          } else if (event.key === "End") {
            event.preventDefault();
            setChatPanePercent(MAX_CHAT_PANE_PERCENT);
          }
        }}
      >
        <span className="pane-divider-grip" aria-hidden="true" />
      </div>

      <aside className="panel">
        <div className="panel-tabs">
          <span className="tab tab-active">Project</span>
        </div>
        <div className="panel-body">
          {projectSlidesDoc ? (
            <div className="project-slides-shell">
              <iframe
                className="project-slides-frame"
                title="Project plan slideshow"
                srcDoc={projectSlidesDoc}
                sandbox="allow-scripts"
              />
            </div>
          ) : (
            <section className="panel-placeholder">
              <p className="panel-kicker">Working draft</p>
              <h2>Your project will show up here as we talk.</h2>
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
          )}
        </div>
      </aside>
    </main>
  );
}

export default App;
