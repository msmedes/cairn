import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";
import type { PanelTab } from "../components/PanelTabs";
import {
  type BriefArtifactEnvelope,
  parseBriefArtifact,
} from "../features/artifacts/briefArtifact";
import {
  type PlanArtifactEnvelope,
  parsePlanArtifact,
} from "../features/artifacts/planArtifact";
import {
  parseTasksArtifact,
  type TasksArtifactEnvelope,
} from "../features/artifacts/tasksArtifact";
import { BugReportDialog } from "../features/bug-report/components/BugReportDialog";
import type { ChatMessage } from "../features/chat/chat-stream";
import { ChatPane } from "../features/chat/components/ChatPane";
import {
  type ActiveProject,
  type McpAuthStatusEvent,
  type PromptImage,
  useSidecarSession,
} from "../features/chat/hooks/useSidecarSession";
import { DevModeLayer } from "../features/dev-mode/components/DevModeLayer";
import {
  type SidecarDevLogEntry,
  useSidecarDevLog,
} from "../features/dev-mode/useSidecarDevLog";
import { useProjectFile } from "../features/project/hooks/useProjectFile";
import {
  type CairnSettingsStatus,
  type McpServerKey,
  type McpSettingsStatus,
  SettingsPanel,
} from "../features/settings/components/SettingsPanel";
import { PaneDivider } from "../features/shell/components/PaneDivider";
import { ProjectPanel } from "../features/shell/components/ProjectPanel";
import { useActivePanelTab } from "../features/shell/hooks/useActivePanelTab";
import { useCreatingIndicator } from "../features/shell/hooks/useCreatingIndicator";
import { usePaneSplit } from "../features/shell/hooks/usePaneSplit";
import { cx } from "../lib/cx";

type BugReportSnapshot = {
  messages: ChatMessage[];
  devEvents: SidecarDevLogEntry[];
  activeProject: ActiveProject | null;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const appClass =
  "app grid h-[calc(100vh-36px)] items-stretch gap-0 [grid-template-columns:minmax(320px,var(--chat-pane,41%))_14px_minmax(360px,calc(var(--project-pane,59%)-14px))] max-[980px]:h-auto max-[980px]:min-h-[calc(100vh-24px)] max-[980px]:grid-cols-1 max-[980px]:gap-3";

function App() {
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
  const { events: devEvents, clearEvents: clearDevEvents } = useSidecarDevLog();
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
  const appStyle: CSSProperties = {
    ["--chat-pane" as string]: `${chatPanePercent}%`,
    ["--project-pane" as string]: `${100 - chatPanePercent}%`,
  };

  function openSettingsPanel() {
    setDevPanelOpen(false);
    setSettingsPanelOpen(true);
    setSettingsMessage(null);
    setMcpMessage(null);
  }

  function submitPrompt(text: string, images: PromptImage[]) {
    void sendPrompt(text, images);
  }

  return (
    <main
      ref={appRef}
      className={cx(appClass, isResizing && "app-resizing")}
      style={appStyle}
    >
      <ChatPane
        messages={messages}
        recents={recents}
        projectOpenError={projectOpenError}
        ready={ready}
        sending={sending}
        recapInteracted={recapInteracted}
        status={statusDot}
        onProjectOpened={(path) => void openProject(path)}
        onProjectDialogOpened={() => void openProjectDialog()}
        onPromptSubmitted={submitPrompt}
        onRecapInteracted={() => setRecapInteracted(true)}
        onStatusClicked={openSettingsPanel}
      />
      <PaneDivider
        chatPanePercent={chatPanePercent}
        isResizing={isResizing}
        onPanePercentChanged={setChatPanePercent}
        onResizeStarted={startResizing}
      />
      <ProjectPanel
        activeTab={activeTab}
        tabs={panelTabs}
        creating={creating}
        briefArtifact={projectBriefArtifact}
        planArtifact={projectPlanArtifact}
        tasksArtifact={projectTasksArtifact}
        onTabSelected={setActiveTab}
      />
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
