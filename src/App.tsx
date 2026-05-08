import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./App.css";
import { BriefArtifactView } from "./BriefArtifactView";
import { BugReportDialog } from "./BugReportDialog";
import {
  type BriefArtifactEnvelope,
  parseBriefArtifact,
} from "./briefArtifact";
import type { ChatMessage } from "./chat-stream";
import { DevModeLayer } from "./DevModeLayer";
import { type PanelTab, PanelTabs } from "./PanelTabs";
import { PlanArtifactView } from "./PlanArtifactView";
import { type PlanArtifactEnvelope, parsePlanArtifact } from "./planArtifact";
import { TasksArtifactView } from "./TasksArtifactView";
import {
  parseTasksArtifact,
  type TasksArtifactEnvelope,
} from "./tasksArtifact";
import { useActivePanelTab } from "./useActivePanelTab";
import { useAutoResizingTextarea } from "./useAutoResizingTextarea";
import { useAutoScroll } from "./useAutoScroll";
import { useCreatingIndicator } from "./useCreatingIndicator";
import {
  DEFAULT_CHAT_PANE_PERCENT,
  MAX_CHAT_PANE_PERCENT,
  MIN_CHAT_PANE_PERCENT,
  usePaneSplit,
} from "./usePaneSplit";
import { useProjectFile } from "./useProjectFile";
import { type SidecarDevLogEntry, useSidecarDevLog } from "./useSidecarDevLog";
import { type ActiveProject, useSidecarSession } from "./useSidecarSession";

type CairnSettingsStatus = {
  hasAnthropicApiKey: boolean;
};

type BugReportSnapshot = {
  messages: ChatMessage[];
  devEvents: SidecarDevLogEntry[];
  activeProject: ActiveProject | null;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function App() {
  const [input, setInput] = useState("");
  const [recapInteracted, setRecapInteracted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsStatus, setSettingsStatus] =
    useState<CairnSettingsStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [appVersion, setAppVersion] = useState("unknown");
  const [bugReportSnapshot, setBugReportSnapshot] =
    useState<BugReportSnapshot | null>(null);
  const projectBriefJson = useProjectFile("brief.json");
  const projectPlanJson = useProjectFile("plan.json");
  const projectTasksJson = useProjectFile("tasks.json");
  const projectPrdsListing = useProjectFile("prds");
  const projectIssuesListing = useProjectFile("issues");
  const projectBriefArtifact: BriefArtifactEnvelope | null = useMemo(
    () => parseBriefArtifact(projectBriefJson),
    [projectBriefJson],
  );
  const projectPlanArtifact: PlanArtifactEnvelope | null = useMemo(
    () => parsePlanArtifact(projectPlanJson),
    [projectPlanJson],
  );
  const projectTasksArtifact: TasksArtifactEnvelope | null = useMemo(
    () => parseTasksArtifact(projectTasksJson),
    [projectTasksJson],
  );
  const hasPlanArtifact = projectPlanArtifact !== null;
  const hasTasksArtifact = projectTasksArtifact !== null;
  const { activeTab, setActiveTab } = useActivePanelTab(
    hasPlanArtifact,
    hasTasksArtifact,
  );
  const creatingContent = useMemo(
    () => ({
      brief: projectBriefJson,
      prd: projectPrdsListing,
      issues: projectIssuesListing,
      plan: projectPlanJson,
      tasks: projectTasksJson,
    }),
    [
      projectBriefJson,
      projectPlanJson,
      projectTasksJson,
      projectPrdsListing,
      projectIssuesListing,
    ],
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
  const {
    messages,
    recents,
    projectOpenError,
    activeProject,
    ready,
    error,
    sending,
    sendPrompt,
    openProject,
    openProjectDialog,
  } = useSidecarSession({
    onCreatingStarted: startCreating,
    onAgentEnd: clearCreatingOnAgentEnd,
    onHydrate: handleHydrate,
    onError: clearCreatingOnError,
  });
  const { events: devEvents, clearEvents: clearDevEvents } = useSidecarDevLog();
  const listRef = useAutoScroll();
  const { composerRef, inputRef } = useAutoResizingTextarea();
  const {
    appRef,
    chatPanePercent,
    isResizing,
    setChatPanePercent,
    startResizing,
  } = usePaneSplit();

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    invoke<CairnSettingsStatus>("get_cairn_settings")
      .then((status) => {
        if (cancelled) return;
        setSettingsStatus(status);
        setSettingsOpen(!status.hasAnthropicApiKey);
      })
      .catch((err) => {
        console.error("get_cairn_settings failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch((err) => {
        console.error("getVersion failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function send() {
    const text = input.trim();
    if (!text || sending || !ready) return;
    setInput("");
    void sendPrompt(text);
  }

  async function saveApiKey() {
    const apiKey = apiKeyInput.trim();
    if (!apiKey || savingApiKey) return;

    setSavingApiKey(true);
    setSettingsMessage(null);
    try {
      const next = await invoke<CairnSettingsStatus>("set_anthropic_api_key", {
        apiKey,
      });
      setSettingsStatus(next);
      setApiKeyInput("");
      setSettingsOpen(false);
      setSettingsMessage("API key saved.");
    } catch (err) {
      console.error("set_anthropic_api_key failed", err);
      setSettingsMessage("Could not save API key.");
    } finally {
      setSavingApiKey(false);
    }
  }

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        invoke("new_project").catch((err) => {
          console.error("new_project failed", err);
        });
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const statusLabel = error ? "error" : ready ? "ready" : "starting…";
  const statusClass = error ? "err" : ready ? "ok" : "wait";
  const panelTabs: PanelTab[] = [
    { key: "project", label: "Project", available: true },
    { key: "plan", label: "Plan", available: true },
    ...(hasTasksArtifact
      ? [{ key: "tasks", label: "Tasks", available: true }]
      : []),
  ];
  const showBriefArtifact = activeTab === "project" && projectBriefArtifact;
  const showPlanArtifact = activeTab === "plan" && projectPlanArtifact;
  const showTasksArtifact = activeTab === "tasks" && projectTasksArtifact;
  const showPlanEmptyState = activeTab === "plan" && !projectPlanArtifact;
  const placeholderCreating =
    showBriefArtifact || showPlanArtifact || showTasksArtifact
      ? null
      : creating;
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
            <h1>Cairn</h1>
          </div>
          <div className="header-actions">
            {settingsStatus && !settingsStatus.hasAnthropicApiKey && (
              <span className="key-warning">API key missing</span>
            )}
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                setSettingsOpen((open) => !open);
                setSettingsMessage(null);
              }}
            >
              API key
            </button>
            <button
              type="button"
              className="bug-report-button"
              onClick={() =>
                setBugReportSnapshot({
                  messages,
                  devEvents,
                  activeProject,
                })
              }
            >
              Report a bug
            </button>
            <DevModeLayer
              messages={messages}
              events={devEvents}
              onEventsCleared={clearDevEvents}
            />
            <span
              className={`status ${statusClass}`}
              title={error ?? undefined}
            >
              {statusLabel}
            </span>
          </div>
        </header>
        {settingsOpen && (
          <form
            className="api-key-settings"
            onSubmit={(event) => {
              event.preventDefault();
              void saveApiKey();
            }}
          >
            <label htmlFor="anthropic-api-key">Anthropic API key</label>
            <input
              id="anthropic-api-key"
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.currentTarget.value)}
              placeholder={
                settingsStatus?.hasAnthropicApiKey
                  ? "Key is already saved"
                  : "sk-ant-..."
              }
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!apiKeyInput.trim() || savingApiKey}
            >
              {savingApiKey ? "Saving…" : "Save"}
            </button>
            {settingsMessage && (
              <p className="api-key-settings-message">{settingsMessage}</p>
            )}
          </form>
        )}

        <div
          className="messages"
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className="empty">
              <div className="empty-topline">
                <p className="empty-kicker">Start with the rough version.</p>
                <button
                  type="button"
                  className="open-folder-button"
                  onClick={() => void openProjectDialog()}
                  disabled={!ready}
                >
                  Open Folder...
                </button>
              </div>
              <p>Tell me what you want this thing to do for people.</p>
              {recents.length > 0 && (
                <ul className="recents-list" aria-label="Recent projects">
                  {recents.map((recent) => (
                    <li key={recent.path}>
                      <button
                        type="button"
                        className="recent-project"
                        aria-label={recent.displayName}
                        onClick={() => void openProject(recent.path)}
                        disabled={!ready}
                      >
                        <span className="recent-name">
                          {recent.displayName}
                        </span>
                        <span className="recent-path">{recent.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {projectOpenError && (
                <p className="open-project-error">{projectOpenError}</p>
              )}
              <p className="hint">
                A quiz for work. A helper for your group. A tiny tool that saves
                time.
              </p>
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

      {/* biome-ignore lint/a11y/useSemanticElements: The splitter is keyboard-focusable and owns a visual grip child. */}
      <div
        className="pane-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat and project panels"
        aria-valuemin={MIN_CHAT_PANE_PERCENT}
        aria-valuemax={MAX_CHAT_PANE_PERCENT}
        aria-valuenow={Math.round(chatPanePercent)}
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
        <PanelTabs
          tabs={panelTabs}
          activeKey={activeTab}
          onSelect={(key) =>
            setActiveTab(
              key === "tasks" ? "tasks" : key === "plan" ? "plan" : "project",
            )
          }
        />
        <div className="panel-body">
          {showBriefArtifact ? (
            <div
              className={`brief-artifact-shell${creating ? " brief-artifact-shell-creating" : ""}`}
            >
              <BriefArtifactView data={projectBriefArtifact.data} />
              {creating && (
                <section className="panel-creating-overlay" aria-live="polite">
                  <p className="panel-kicker">Working draft</p>
                  <h2>{creating.message}</h2>
                </section>
              )}
            </div>
          ) : showPlanArtifact ? (
            <div
              className={`plan-artifact-shell${creating ? " plan-artifact-shell-creating" : ""}`}
            >
              <PlanArtifactView data={projectPlanArtifact.data} />
              {creating && (
                <section className="panel-creating-overlay" aria-live="polite">
                  <p className="panel-kicker">Working draft</p>
                  <h2>{creating.message}</h2>
                </section>
              )}
            </div>
          ) : showTasksArtifact ? (
            <div
              className={`tasks-artifact-shell${creating ? " tasks-artifact-shell-creating" : ""}`}
            >
              <TasksArtifactView data={projectTasksArtifact.data} />
              {creating && (
                <section className="panel-creating-overlay" aria-live="polite">
                  <p className="panel-kicker">Working draft</p>
                  <h2>{creating.message}</h2>
                </section>
              )}
            </div>
          ) : showPlanEmptyState ? (
            <section
              className={`panel-placeholder${placeholderCreating ? " panel-placeholder-creating" : ""}`}
            >
              <p className="panel-kicker">
                {placeholderCreating ? "Working draft" : "Plan"}
              </p>
              <h2>
                {placeholderCreating
                  ? placeholderCreating.message
                  : "Once we agree on what to build first, the plan will show up here."}
              </h2>
              <div className="panel-ghost">
                <div className="ghost-line ghost-line-title" />
                <div className="ghost-line ghost-line-wide" />
                <div className="ghost-line ghost-line-mid" />
                <div className="ghost-line ghost-line-wide" />
                <div className="ghost-line ghost-line-short" />
              </div>
            </section>
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
                  As the conversation sharpens, this panel will turn your
                  answers into a short readable plan.
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
      {bugReportSnapshot && (
        <BugReportDialog
          messages={bugReportSnapshot.messages}
          devEvents={bugReportSnapshot.devEvents}
          activeProject={
            bugReportSnapshot.activeProject
              ? {
                  path: bugReportSnapshot.activeProject.path,
                  displayName: bugReportSnapshot.activeProject.displayName,
                }
              : null
          }
          appVersion={appVersion}
          onClosed={() => setBugReportSnapshot(null)}
        />
      )}
    </main>
  );
}

export default App;
