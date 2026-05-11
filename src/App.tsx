import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import type { ImageAttachmentRejectionReason } from "./imageAttachment";
import { type PanelTab, PanelTabs } from "./PanelTabs";
import { PlanArtifactView } from "./PlanArtifactView";
import { type PlanArtifactEnvelope, parsePlanArtifact } from "./planArtifact";
import {
  type CairnSettingsStatus,
  type McpServerKey,
  type McpSettingsStatus,
  SettingsPanel,
} from "./SettingsPanel";
import { TasksArtifactView } from "./TasksArtifactView";
import {
  parseTasksArtifact,
  type TasksArtifactEnvelope,
} from "./tasksArtifact";
import { useActivePanelTab } from "./useActivePanelTab";
import { useAutoResizingTextarea } from "./useAutoResizingTextarea";
import { useAutoScroll } from "./useAutoScroll";
import { useComposerAttachments } from "./useComposerAttachments";
import { useCreatingIndicator } from "./useCreatingIndicator";
import {
  DEFAULT_CHAT_PANE_PERCENT,
  MAX_CHAT_PANE_PERCENT,
  MIN_CHAT_PANE_PERCENT,
  usePaneSplit,
} from "./usePaneSplit";
import { useProjectFile } from "./useProjectFile";
import { type SidecarDevLogEntry, useSidecarDevLog } from "./useSidecarDevLog";
import {
  type ActiveProject,
  type McpAuthStatusEvent,
  useSidecarSession,
} from "./useSidecarSession";

type BugReportSnapshot = {
  messages: ChatMessage[];
  devEvents: SidecarDevLogEntry[];
  activeProject: ActiveProject | null;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function attachmentRejectionLabel(reason: ImageAttachmentRejectionReason) {
  switch (reason) {
    case "unsupported-type":
      return "Only PNG, JPEG, WebP, and GIF images can be attached.";
    case "too-large":
      return "Images must be 5 MB or smaller.";
    case "unreadable":
      return "This image could not be read.";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

function App() {
  const [input, setInput] = useState("");
  const [recapInteracted, setRecapInteracted] = useState(false);
  const [settingsStatus, setSettingsStatus] =
    useState<CairnSettingsStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpSettingsStatus | null>(null);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [updatingMcpServer, setUpdatingMcpServer] =
    useState<McpServerKey | null>(null);
  const [appVersion, setAppVersion] = useState("unknown");
  const [bugReportSnapshot, setBugReportSnapshot] =
    useState<BugReportSnapshot | null>(null);
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
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
  const handleMcpAuthStatus = useCallback((event: McpAuthStatusEvent) => {
    setMcpMessage(event.message);
  }, []);
  const {
    messages,
    recents,
    projectOpenError,
    activeProject,
    ready,
    error,
    sending,
    sendPrompt,
    authenticateMcpServer,
    openProject,
    openProjectDialog,
  } = useSidecarSession({
    onCreatingStarted: startCreating,
    onAgentEnd: clearCreatingOnAgentEnd,
    onHydrate: handleHydrate,
    onError: clearCreatingOnError,
    onMcpAuthStatus: handleMcpAuthStatus,
  });
  const composerAttachments = useComposerAttachments();
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
        if (!status.hasAnthropicApiKey) {
          setSettingsPanelOpen(true);
        }
      })
      .catch((err) => {
        console.error("get_cairn_settings failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeProjectPath = activeProject?.path ?? null;

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    invoke<McpSettingsStatus>("get_mcp_settings", {
      projectPath: activeProjectPath,
    })
      .then((status) => {
        if (!cancelled) setMcpStatus(status);
      })
      .catch((err) => {
        console.error("get_mcp_settings failed", err);
        if (!cancelled) setMcpMessage("Could not load MCP settings.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectPath]);

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
    if (
      (!text && composerAttachments.images.length === 0) ||
      sending ||
      !ready
    ) {
      return;
    }
    const images = composerAttachments.images.map(
      ({ data, mimeType, dataUrl }) => ({
        data,
        mimeType,
        dataUrl,
      }),
    );
    setInput("");
    composerAttachments.clear();
    void sendPrompt(text, images);
  }

  function addDroppedFiles(event: DragEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void composerAttachments.addFiles(files);
    }
  }

  function addPastedImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items).flatMap((item) => {
      if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    });
    if (files.length === 0) return;
    event.preventDefault();
    void composerAttachments.addFiles(files);
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
    } catch (err) {
      console.error("set_anthropic_api_key failed", err);
      setSettingsMessage("Could not save API key.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function setMcpServerEnabled(server: McpServerKey, enabled: boolean) {
    if (updatingMcpServer) return;

    setUpdatingMcpServer(server);
    setMcpMessage(null);
    try {
      const next = await invoke<McpSettingsStatus>("set_mcp_server_enabled", {
        server,
        enabled,
      });
      setMcpStatus(next);
      setMcpMessage(enabled ? "MCP server added." : "MCP server removed.");
    } catch (err) {
      console.error("set_mcp_server_enabled failed", err);
      setMcpMessage("Could not update MCP settings.");
    } finally {
      setUpdatingMcpServer(null);
    }
  }

  async function requestMcpAuth(server: McpServerKey) {
    setMcpMessage(`Opening ${server} OAuth in your browser...`);
    try {
      await authenticateMcpServer(server);
    } catch (err) {
      console.error("authenticate_mcp_server failed", err);
      setMcpMessage(`Could not start ${server} OAuth.`);
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

  const bugReportInputsRef = useRef({ messages, devEvents, activeProject });
  useEffect(() => {
    bugReportInputsRef.current = { messages, devEvents, activeProject };
  }, [messages, devEvents, activeProject]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    listen<string>("menu-event", (event) => {
      switch (event.payload) {
        case "settings":
          setDevPanelOpen(false);
          setSettingsPanelOpen(true);
          setSettingsMessage(null);
          setMcpMessage(null);
          break;
        case "report-bug":
          setDevPanelOpen(false);
          setSettingsPanelOpen(false);
          setBugReportSnapshot({ ...bugReportInputsRef.current });
          break;
        case "dev-panel":
          setSettingsPanelOpen(false);
          setDevPanelOpen(true);
          break;
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          cleanup = unlisten;
        }
      })
      .catch((err) => {
        console.error("menu-event listen failed", err);
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const statusDot = (() => {
    if (error) {
      return { tone: "err", tooltip: error } as const;
    }
    if (!ready) {
      return { tone: "wait", tooltip: "Starting…" } as const;
    }
    if (settingsStatus && !settingsStatus.hasAnthropicApiKey) {
      return {
        tone: "attention",
        tooltip: "API key missing — click for Settings",
      } as const;
    }
    return { tone: "ok", tooltip: "Ready" } as const;
  })();
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
  const visibleMessages = messages.filter((message) => {
    const hasImages = (message.images?.length ?? 0) > 0;
    return message.text.trim() !== "" || hasImages || !message.done;
  });
  const canSend =
    ready &&
    !sending &&
    (input.trim() !== "" || composerAttachments.images.length > 0);

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
            <button
              type="button"
              className={`status-dot status-dot-${statusDot.tone}`}
              title={statusDot.tooltip}
              aria-label={`Status: ${statusDot.tooltip}`}
              onClick={() => {
                setDevPanelOpen(false);
                setSettingsPanelOpen(true);
                setSettingsMessage(null);
                setMcpMessage(null);
              }}
            />
          </div>
        </header>

        <div
          className="messages"
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className="empty">
              <button
                type="button"
                className="open-folder-button"
                onClick={() => void openProjectDialog()}
                disabled={!ready}
              >
                Open Folder…
              </button>
              {recents.length > 0 && (
                <>
                  <p className="empty-recents-label">Recent</p>
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
                </>
              )}
              {projectOpenError && (
                <p className="open-project-error">{projectOpenError}</p>
              )}
            </div>
          )}
          {visibleMessages.map((m) => {
            const isPendingAssistant =
              m.role === "assistant" && m.text.trim() === "" && !m.done;
            const recapClass =
              m.kind === "recap"
                ? recapInteracted
                  ? " msg-recap msg-recap-faded"
                  : " msg-recap"
                : "";
            return (
              <div key={m.id} className={`msg-row msg-row-${m.role}`}>
                <div
                  className={`msg msg-${m.role}${recapClass}${
                    isPendingAssistant ? " msg-pending" : ""
                  }`}
                >
                  {isPendingAssistant ? (
                    <span
                      className="typing-dots"
                      role="status"
                      aria-label="Cairn is working"
                    >
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    <>
                      {(m.images?.length ?? 0) > 0 && (
                        <div className="msg-image-strip">
                          {m.images?.map((image) => (
                            <img
                              key={`${image.mimeType}:${image.dataUrl}`}
                              src={image.dataUrl}
                              alt={image.mimeType}
                            />
                          ))}
                        </div>
                      )}
                      {m.text && <span>{m.text}</span>}
                    </>
                  )}
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
          {(composerAttachments.images.length > 0 ||
            composerAttachments.rejections.length > 0) && (
            <div className="composer-attachment-panel">
              {composerAttachments.images.length > 0 && (
                <ul
                  className="composer-attachment-list"
                  aria-label="Attached images"
                >
                  {composerAttachments.images.map((image) => (
                    <li className="composer-attachment-chip" key={image.id}>
                      <img src={image.dataUrl} alt={image.mimeType} />
                      <button
                        type="button"
                        aria-label={`Remove ${image.mimeType} attachment`}
                        onClick={() => composerAttachments.remove(image.id)}
                      >
                        x
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {composerAttachments.rejections.map((rejection) => (
                <p className="composer-attachment-rejection" key={rejection.id}>
                  {rejection.fileName}:{" "}
                  {attachmentRejectionLabel(rejection.reason)}
                </p>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            placeholder={ready ? "Type a message…" : "Waking up…"}
            value={input}
            onFocus={() => setRecapInteracted(true)}
            onChange={(e) => setInput(e.currentTarget.value)}
            onPaste={addPastedImages}
            onDragOver={(e) => e.preventDefault()}
            onDrop={addDroppedFiles}
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
          <button type="submit" disabled={!canSend}>
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
      <DevModeLayer
        isOpen={devPanelOpen}
        onClose={() => setDevPanelOpen(false)}
        messages={messages}
        events={devEvents}
        onEventsCleared={clearDevEvents}
      />
      <SettingsPanel
        isOpen={settingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        settingsStatus={settingsStatus}
        apiKeyInput={apiKeyInput}
        settingsMessage={settingsMessage}
        savingApiKey={savingApiKey}
        mcpStatus={mcpStatus}
        mcpMessage={mcpMessage}
        updatingMcpServer={updatingMcpServer}
        onApiKeyInputChanged={setApiKeyInput}
        onApiKeySaved={() => void saveApiKey()}
        onMcpServerToggled={(server, enabled) =>
          void setMcpServerEnabled(server, enabled)
        }
        onMcpAuthRequested={(server) => void requestMcpAuth(server)}
      />
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
