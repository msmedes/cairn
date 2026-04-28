import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";

type SidecarEvent =
  | { type: "ready" }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean }
  | { type: "agent_end" }
  | { type: "error"; message: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
};

function newId() {
  return Math.random().toString(36).slice(2);
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);

  // Track the in-flight assistant message so streamed deltas land in the right place.
  const activeAssistantId = useRef<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<SidecarEvent>("sidecar-event", (event) => {
      const payload = event.payload;
      switch (payload.type) {
        case "ready":
          setReady(true);
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
        case "agent_end": {
          activeAssistantId.current = null;
          setSending(false);
          break;
        }
        case "tool_start":
        case "tool_end":
          // Invisible to the user; visible in the dev console.
          // eslint-disable-next-line no-console
          console.debug("[sidecar tool]", payload);
          break;
        case "error":
          // eslint-disable-next-line no-console
          console.error("[sidecar error]", payload.message);
          activeAssistantId.current = null;
          setSending(false);
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
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
    activeAssistantId.current = assistantMsg.id;
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    try {
      await invoke("send_prompt", { text });
    } catch (err) {
      console.error("send_prompt failed", err);
      activeAssistantId.current = null;
      setSending(false);
    }
  }

  return (
    <main className="app">
      <section className="chat">
        <header className="chat-header">
          <h1>Guide</h1>
          <span className={`status ${ready ? "ok" : "wait"}`}>
            {ready ? "ready" : "starting…"}
          </span>
        </header>

        <div className="messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="empty">
              <p>Tell me what you'd like to build.</p>
              <p className="hint">A quiz for work? A helper for your group?</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg msg-${m.role}`}>
              {m.text || (m.role === "assistant" && !m.done ? "…" : "")}
            </div>
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            type="text"
            placeholder={ready ? "Type a message…" : "Waking up…"}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            disabled={!ready || sending}
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
          <p className="panel-empty">
            Your project will show up here as we talk.
          </p>
        </div>
      </aside>
    </main>
  );
}

export default App;
