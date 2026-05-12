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
import { Composer } from "../features/chat/components/Composer";
import { MessageList } from "../features/chat/components/MessageList";
import { QuestionCard } from "../features/chat/components/QuestionCard";
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
import { SettingsPanel } from "../features/settings/components/SettingsPanel";
import { useSettingsBridge } from "../features/settings/hooks/useSettingsBridge";
import { PaneDivider } from "../features/shell/components/PaneDivider";
import {
  ProjectPanel,
  type ProjectPanelTabItem,
} from "../features/shell/components/ProjectPanel";
import { useActivePanelTab } from "../features/shell/hooks/useActivePanelTab";
import { useCreatingIndicator } from "../features/shell/hooks/useCreatingIndicator";
import { usePaneSplit } from "../features/shell/hooks/usePaneSplit";
import { cx } from "../lib/cx";
import { hasTauriRuntime } from "../lib/tauri";

type BugReportSnapshot = {
  messages: ChatMessage[];
  devEvents: SidecarDevLogEntry[];
  activeProject: ActiveProject | null;
};

const appClass =
  "app grid h-[calc(100vh-36px)] items-stretch gap-0 [grid-template-columns:minmax(320px,var(--chat-pane,41%))_14px_minmax(360px,calc(var(--project-pane,59%)-14px))] max-[980px]:h-auto max-[980px]:min-h-[calc(100vh-24px)] max-[980px]:grid-cols-1 max-[980px]:gap-3";

function App() {
  const [recapInteracted, setRecapInteracted] = useState(false);
  const [bugReportSnapshot, setBugReportSnapshot] =
    useState<BugReportSnapshot | null>(null);
  const [devPanelOpen, setDevPanelOpen] = useState(false);
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
  const mcpAuthStatusHandlerRef = useRef<(event: McpAuthStatusEvent) => void>(
    () => {},
  );
  const handleMcpAuthStatus = useCallback((event: McpAuthStatusEvent) => {
    mcpAuthStatusHandlerRef.current(event);
  }, []);
  const {
    messages,
    recents,
    projectOpenError,
    activeProject,
    pendingQuestion,
    ready,
    error,
    sending,
    sendPrompt,
    submitQuestionAnswer,
    cancelQuestion,
    submittingQuestion,
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
  const activeProjectPath = activeProject?.path ?? null;
  const settings = useSettingsBridge({
    activeProjectPath,
    authenticateMcpServer,
  });
  mcpAuthStatusHandlerRef.current = (event) => {
    settings.setMcpMessage(event.message);
  };

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
          settings.openSettingsPanel();
          break;
        case "report-bug":
          setDevPanelOpen(false);
          settings.closeSettingsPanel();
          setBugReportSnapshot({ ...bugReportInputsRef.current });
          break;
        case "dev-panel":
          settings.closeSettingsPanel();
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
  }, [settings.closeSettingsPanel, settings.openSettingsPanel]);

  const statusDot = (() => {
    if (error) {
      return { tone: "err", tooltip: error } as const;
    }
    if (!ready) {
      return { tone: "wait", tooltip: "Starting…" } as const;
    }
    if (
      settings.settingsStatus &&
      !settings.settingsStatus.hasAnthropicApiKey
    ) {
      return {
        tone: "attention",
        tooltip: "API key missing — click for Settings",
      } as const;
    }
    return { tone: "ok", tooltip: "Ready" } as const;
  })();
  const panelTabs: ProjectPanelTabItem[] = [
    { key: "project", label: "Project", available: true },
    { key: "plan", label: "Plan", available: true },
  ];
  if (hasTasksArtifact) {
    panelTabs.push({ key: "tasks", label: "Tasks", available: true });
  }
  const appStyle: CSSProperties = {
    ["--chat-pane" as string]: `${chatPanePercent}%`,
    ["--project-pane" as string]: `${100 - chatPanePercent}%`,
  };

  function openSettingsPanel() {
    setDevPanelOpen(false);
    settings.openSettingsPanel();
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
      <ChatPane status={statusDot} onStatusClicked={openSettingsPanel}>
        <MessageList
          messages={messages}
          recents={recents}
          projectOpenError={projectOpenError}
          isReady={ready}
          hasRecapInteracted={recapInteracted}
          onProjectOpened={(path) => void openProject(path)}
          onProjectDialogOpened={() => void openProjectDialog()}
        />
        {pendingQuestion ? (
          <QuestionCard
            pendingQuestion={pendingQuestion}
            isSubmitting={submittingQuestion}
            onSubmitted={(answers) => void submitQuestionAnswer(answers)}
            onSkipped={() => void cancelQuestion()}
          />
        ) : (
          <Composer
            isReady={ready}
            isSending={sending}
            onPromptSubmitted={submitPrompt}
            onRecapInteracted={() => setRecapInteracted(true)}
          />
        )}
      </ChatPane>
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
        isOpen={settings.settingsPanelOpen}
        onClose={settings.closeSettingsPanel}
        settingsStatus={settings.settingsStatus}
        apiKeyInput={settings.apiKeyInput}
        settingsMessage={settings.settingsMessage}
        savingApiKey={settings.savingApiKey}
        mcpStatus={settings.mcpStatus}
        mcpMessage={settings.mcpMessage}
        updatingMcpServer={settings.updatingMcpServer}
        onApiKeyInputChanged={settings.setApiKeyInput}
        onApiKeySaved={() => void settings.saveApiKey()}
        onMcpServerToggled={(server, enabled) =>
          void settings.setMcpServerEnabled(server, enabled)
        }
        onMcpAuthRequested={(server) => void settings.requestMcpAuth(server)}
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
          appVersion={settings.appVersion}
          onClosed={() => setBugReportSnapshot(null)}
        />
      )}
    </main>
  );
}

export default App;
