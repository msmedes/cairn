import { useCallback, useMemo, useState, type CSSProperties } from "react";
import "./App.css";
import { buildSlidesDocument } from "./projectSlides";
import { useAutoScroll } from "./useAutoScroll";
import { useCreatingIndicator } from "./useCreatingIndicator";
import { useAutoResizingTextarea } from "./useAutoResizingTextarea";
import {
  DEFAULT_CHAT_PANE_PERCENT,
  MAX_CHAT_PANE_PERCENT,
  MIN_CHAT_PANE_PERCENT,
  usePaneSplit,
} from "./usePaneSplit";
import { useProjectFile } from "./useProjectFile";
import { useSidecarSession } from "./useSidecarSession";

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
  const [input, setInput] = useState("");
  const [recapInteracted, setRecapInteracted] = useState(false);
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
  const creatingContent = useMemo(
    () => ({ brief: normalizedProjectBrief }),
    [normalizedProjectBrief],
  );
  const {
    creating,
    creating_started: startCreating,
    agent_end: clearCreatingOnAgentEnd,
    hydrate: clearCreatingOnHydrate,
    error: clearCreatingOnError,
  } = useCreatingIndicator(creatingContent);
  const handleHydrate = useCallback(() => {
    clearCreatingOnHydrate();
    setRecapInteracted(false);
  }, [clearCreatingOnHydrate]);
  const { messages, ready, error, sending, sendPrompt } = useSidecarSession({
    onCreatingStarted: startCreating,
    onAgentEnd: clearCreatingOnAgentEnd,
    onHydrate: handleHydrate,
    onError: clearCreatingOnError,
  });
  const listRef = useAutoScroll(messages);
  const { composerRef, inputRef } = useAutoResizingTextarea(input);
  const {
    appRef,
    chatPanePercent,
    isResizing,
    setChatPanePercent,
    startResizing,
  } = usePaneSplit();

  function send() {
    const text = input.trim();
    if (!text || sending || !ready) return;
    setInput("");
    void sendPrompt(text);
  }

  const statusLabel = error ? "error" : ready ? "ready" : "starting…";
  const statusClass = error ? "err" : ready ? "ok" : "wait";
  const appStyle: CSSProperties = {
    ["--chat-pane" as string]: `${chatPanePercent}%`,
    ["--project-pane" as string]: `${100 - chatPanePercent}%`,
  };
  const placeholderCreating = projectSlidesDoc ? null : creating;

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
          {messages.map((m) => {
            const recapClass =
              m.kind === "recap"
                ? recapInteracted
                  ? " msg-recap msg-recap-faded"
                  : " msg-recap"
                : "";
            return (
              <div key={m.id} className={`msg-row msg-row-${m.role}`}>
                <div className={`msg msg-${m.role}${recapClass}`}>
                  {m.text || (m.role === "assistant" && !m.done ? "…" : "")}
                </div>
              </div>
            );
          })}
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
            onFocus={() => setRecapInteracted(true)}
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
            setChatPanePercent((prev) => prev - 3);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setChatPanePercent((prev) => prev + 3);
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
            <section
              className={`panel-placeholder${placeholderCreating ? " panel-placeholder-creating" : ""}`}
            >
              <p className="panel-kicker">Working draft</p>
              <h2>
                {placeholderCreating
                  ? placeholderCreating.message
                  : "Your project will show up here as we talk."}
              </h2>
              {!placeholderCreating && (
                <p className="panel-empty">
                  As the conversation sharpens, this panel will turn your answers into a short readable plan.
                </p>
              )}
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
