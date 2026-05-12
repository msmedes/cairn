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

function chatMessageImagesWithKeys(message: ChatMessage) {
  const imageCounts = new Map<string, number>();

  return (message.images ?? []).map((image) => {
    const imageKey = `${image.mimeType}:${image.dataUrl}`;
    const occurrence = imageCounts.get(imageKey) ?? 0;
    imageCounts.set(imageKey, occurrence + 1);

    return {
      image,
      key: `${message.id}:image:${imageKey}:${occurrence}`,
    };
  });
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const appClass =
  "app grid h-[calc(100vh-36px)] items-stretch gap-0 [grid-template-columns:minmax(320px,var(--chat-pane,41%))_14px_minmax(360px,calc(var(--project-pane,59%)-14px))] max-[980px]:h-auto max-[980px]:min-h-[calc(100vh-24px)] max-[980px]:grid-cols-1 max-[980px]:gap-3";

const surfaceClass =
  "min-h-0 min-w-0 overflow-hidden rounded-shell bg-[var(--surface)] shadow-kanagawa-lg outline outline-1 outline-[var(--line)] backdrop-blur-[18px]";

const chatClass = `chat ${surfaceClass} flex flex-col max-[980px]:min-h-[62vh]`;

const panelClass = `panel ${surfaceClass} flex flex-col max-[980px]:min-h-[280px]`;

const chatHeaderClass =
  "chat-header flex items-start justify-between gap-6 px-7 pb-[22px] pt-[26px] max-[980px]:flex-col max-[980px]:items-start max-[640px]:px-5 max-[640px]:pb-[18px] max-[640px]:pt-[22px]";

const brandClass =
  "brand inline-flex max-w-xl items-center gap-3.5 animate-[rise-in_520ms_cubic-bezier(0.2,0,0,1)]";

const brandTitleClass =
  "m-0 font-serif text-[1.9rem] font-semibold leading-none tracking-[-0.03em] text-balance";

const statusDotClass =
  "status-dot inline-block h-3 w-3 cursor-pointer rounded-full border-0 bg-kanagawa-text-soft p-0 shadow-[0_0_0_4px_transparent] transition-[background-color,box-shadow,transform] duration-[220ms,220ms,120ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1)] hover:shadow-[0_0_0_4px_rgba(126,156,216,0.18),var(--status-dot-halo,0_0_0_0_transparent)] focus-visible:shadow-[0_0_0_4px_rgba(126,156,216,0.18),var(--status-dot-halo,0_0_0_0_transparent)] focus-visible:outline-none active:scale-[0.92]";

const statusDotToneClass = {
  ok: "status-dot-ok bg-kanagawa-green [--status-dot-halo:0_0_0_4px_rgba(152,187,108,0.18)] shadow-[var(--status-dot-halo)]",
  wait: "status-dot-wait bg-kanagawa-yellow [--status-dot-halo:0_0_0_4px_rgba(220,165,97,0.18)] shadow-[var(--status-dot-halo)]",
  attention:
    "status-dot-attention bg-kanagawa-yellow [--status-dot-halo:0_0_0_4px_rgba(220,165,97,0.22)] shadow-[var(--status-dot-halo)] animate-[status-dot-pulse_2.4s_ease-in-out_infinite] motion-reduce:animate-none",
  err: "status-dot-err bg-kanagawa-red [--status-dot-halo:0_0_0_4px_rgba(195,64,67,0.22)] shadow-[var(--status-dot-halo)]",
} as const;

const messagesClass =
  "messages min-h-0 flex flex-1 flex-col gap-[18px] overflow-y-auto px-7 pb-7 pt-1 max-[640px]:px-5 max-[640px]:pb-5 max-[640px]:pt-0";

const emptyClass =
  "empty m-auto flex w-[min(28rem,100%)] flex-col gap-3.5 p-[22px]";

const openFolderButtonClass =
  "open-folder-button min-h-11 cursor-pointer self-stretch rounded-md border-0 bg-[rgba(126,156,216,0.14)] px-4 py-0 font-[inherit] text-[0.92rem] font-semibold tracking-[-0.005em] text-kanagawa-text transition-[background-color,transform,box-shadow] duration-[180ms,120ms,180ms] ease-[ease,cubic-bezier(0.2,0,0,1),ease] hover:not-disabled:bg-[rgba(126,156,216,0.22)] focus-visible:not-disabled:bg-[rgba(126,156,216,0.22)] focus-visible:not-disabled:shadow-[0_0_0_3px_rgba(126,156,216,0.22)] focus-visible:not-disabled:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

const recentsLabelClass =
  "empty-recents-label mt-[18px] pl-3.5 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-kanagawa-text-soft";

const recentsListClass = "recents-list mt-2 grid list-none gap-1 p-0";

const recentProjectClass =
  "recent-project grid min-h-12 w-full min-w-0 cursor-pointer gap-[3px] rounded-md border-0 bg-[rgba(22,22,29,0.32)] px-3.5 py-2.5 text-left font-[inherit] text-kanagawa-text transition-[background-color,transform,box-shadow] duration-[180ms,120ms,180ms] ease-[ease,cubic-bezier(0.2,0,0,1),ease] hover:not-disabled:bg-[rgba(126,156,216,0.1)] focus-visible:not-disabled:bg-[rgba(126,156,216,0.1)] focus-visible:not-disabled:shadow-[0_0_0_3px_rgba(126,156,216,0.22)] focus-visible:not-disabled:outline-none active:not-disabled:scale-[0.98]";

const recentNameClass =
  "recent-name block min-w-0 truncate text-[0.92rem] font-semibold tracking-[-0.005em]";

const recentPathClass =
  "recent-path block min-w-0 truncate font-mono text-[0.76rem] text-kanagawa-text-soft tabular-nums";

const openProjectErrorClass =
  "open-project-error mt-3.5 text-sm leading-[1.4] text-[#e46876]";

const messageRowClass = {
  user: "msg-row msg-row-user flex justify-end",
  assistant: "msg-row msg-row-assistant flex justify-start",
} as const;

const messageBaseClass =
  "msg whitespace-pre-wrap break-words [text-wrap:pretty]";

const messageRoleClass = {
  user: "msg-user max-w-[min(54rem,80%)] rounded-[6px_6px_2px_6px] bg-[linear-gradient(180deg,var(--user-bg-soft),var(--user-bg))] px-[18px] py-4 text-kanagawa-user-text shadow-[0_1px_1px_rgba(255,255,255,0.04)_inset,0_20px_34px_rgba(18,13,11,0.2)] max-[980px]:max-w-[92%]",
  assistant:
    "msg-assistant max-w-[min(52rem,88%)] rounded-[2px_6px_6px_6px] bg-[var(--assistant-wash)] px-5 py-[18px] text-[1.02rem] leading-[1.6] shadow-kanagawa-sm max-[980px]:max-w-[92%]",
} as const;

const pendingMessageClass =
  "msg-pending inline-flex min-h-11 min-w-16 items-center";

const messageImageStripClass = "msg-image-strip mb-2.5 flex flex-wrap gap-2";

const messageImageClass =
  "max-h-20 max-w-[min(180px,100%)] rounded-card bg-[rgba(22,22,29,0.4)] object-contain shadow-[inset_0_0_0_1px_rgba(220,215,186,0.1)]";

const typingDotsClass = "typing-dots inline-flex items-center gap-[5px]";

const typingDotClass = "h-1.5 w-1.5 rounded-full bg-current opacity-[0.38]";

const composerClass =
  "composer grid items-end gap-3 px-7 pb-[22px] pt-3.5 [grid-template-columns:minmax(0,1fr)_auto] max-[640px]:mx-3 max-[640px]:mb-3 max-[640px]:mt-0 max-[640px]:grid-cols-1 max-[640px]:p-3";

const attachmentPanelClass =
  "composer-attachment-panel col-span-full grid min-w-0 gap-2";

const attachmentListClass =
  "composer-attachment-list m-0 flex min-w-0 list-none flex-wrap gap-2 p-0";

const attachmentChipClass =
  "composer-attachment-chip relative grid h-[54px] w-[70px] place-items-center overflow-hidden rounded-md bg-kanagawa-surface-strong shadow-[inset_0_0_0_1px_rgba(220,215,186,0.1),0_8px_18px_rgba(0,0,0,0.16)]";

const attachmentImageClass = "h-full w-full object-cover";

const attachmentRemoveButtonClass =
  "absolute right-1 top-1 grid h-5 min-h-5 w-5 min-w-5 place-items-center rounded-full bg-[rgba(22,22,29,0.78)] p-0 text-[0.86rem] leading-none text-kanagawa-text shadow-[inset_0_0_0_1px_rgba(220,215,186,0.18)] hover:not-disabled:bg-[rgba(195,64,67,0.9)] hover:not-disabled:text-white focus-visible:not-disabled:bg-[rgba(195,64,67,0.9)] focus-visible:not-disabled:text-white";

const attachmentRejectionClass =
  "composer-attachment-rejection m-0 text-[0.82rem] leading-[1.35] text-[#e46876]";

const composerTextareaClass =
  "min-h-11 w-full rounded-md border-0 bg-kanagawa-surface-strong px-3.5 py-[11px] font-[inherit] leading-[1.45] text-kanagawa-text shadow-[inset_0_0_0_1px_rgba(220,215,186,0.08),0_1px_1px_rgba(0,0,0,0.28)] outline-none transition-[box-shadow,background-color] duration-180 ease-in placeholder:text-kanagawa-text-soft focus:bg-[rgb(42,42,55)] focus:shadow-[inset_0_0_0_1px_rgba(126,156,216,0.46),0_0_0_4px_rgba(126,156,216,0.12)] disabled:opacity-65 block resize-none overflow-y-auto";

const composerButtonClass =
  "min-h-11 rounded-md border-0 bg-[rgba(42,42,55,0.7)] px-[18px] py-0 font-[inherit] font-semibold tracking-[-0.01em] text-kanagawa-text-soft shadow-[inset_0_0_0_1px_rgba(220,215,186,0.06)] transition-[transform,box-shadow,opacity,background] duration-[120ms,180ms,180ms,180ms] ease-[cubic-bezier(0.2,0,0,1),ease,ease,ease] enabled:cursor-pointer enabled:bg-[linear-gradient(180deg,#7e9cd8,#658594)] enabled:text-kanagawa-bg enabled:shadow-[0_1px_1px_rgba(255,255,255,0.12)_inset,0_10px_20px_rgba(101,133,148,0.22)] hover:enabled:shadow-[0_1px_1px_rgba(255,255,255,0.16)_inset,0_14px_26px_rgba(101,133,148,0.28)] focus-visible:enabled:shadow-[0_1px_1px_rgba(255,255,255,0.16)_inset,0_0_0_3px_rgba(126,156,216,0.32),0_10px_20px_rgba(101,133,148,0.22)] focus-visible:enabled:outline-none active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:[background:rgba(42,42,55,0.7)]";

const paneDividerClass =
  "pane-divider relative w-[14px] cursor-col-resize outline-none max-[980px]:hidden";

const paneDividerGripClass =
  "pane-divider-grip absolute left-1/2 top-1/2 h-11 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-45";

const paneDividerGripActiveClass = "h-[120px] w-2 opacity-100";

const panelBodyClass =
  "panel-body flex min-h-0 flex-1 flex-col px-[18px] pb-[18px] pt-0 max-[640px]:px-4 max-[640px]:pb-4 max-[640px]:pt-0";

const artifactShellClass =
  "relative min-h-0 flex-1 overflow-auto rounded-none bg-transparent";

const panelCreatingOverlayClass =
  "panel-creating-overlay absolute bottom-6 left-6 right-6 max-w-lg rounded-card bg-[rgba(31,31,40,0.92)] px-6 py-[22px] shadow-kanagawa-md outline outline-1 outline-[var(--line)] animate-[panel-creating-text-in_320ms_cubic-bezier(0.2,0,0,1)_both]";

const panelKickerClass =
  "panel-kicker mb-2 mt-0 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-kanagawa-text-soft";

const panelOverlayTitleClass =
  "m-0 max-w-[24ch] text-balance font-serif text-[clamp(1.25rem,1.06rem+0.58vw,1.58rem)] font-semibold leading-[1.12] tracking-[-0.03em]";

const panelPlaceholderClass =
  "panel-placeholder flex h-full flex-1 flex-col justify-center px-2.5 py-7 animate-[rise-in_580ms_cubic-bezier(0.2,0,0,1)_90ms_both] max-[640px]:px-5 max-[640px]:py-[22px]";

const panelPlaceholderTitleClass =
  "max-w-[16ch] text-balance font-serif text-[clamp(1.5rem,1.28rem+0.7vw,1.9rem)] font-semibold leading-[1.08] tracking-[-0.03em]";

const panelPlaceholderCreatingTitleClass =
  "animate-[panel-creating-text-in_320ms_cubic-bezier(0.2,0,0,1)_both]";

const panelEmptyClass =
  "panel-empty mt-3.5 mb-0 max-w-[34ch] text-base leading-[1.6] text-kanagawa-text-muted [text-wrap:pretty]";

const panelGhostClass =
  "panel-ghost mt-7 grid gap-3 rounded-card bg-[rgba(45,79,103,0.18)] p-[22px] shadow-[inset_0_0_0_1px_rgba(220,215,186,0.05)]";

const panelGhostCreatingClass =
  "animate-[panel-creating-pulse_2.4s_ease-in-out_infinite]";

const ghostLineClass =
  "ghost-line h-[11px] rounded-card bg-[linear-gradient(90deg,rgba(126,156,216,0.12),rgba(220,215,186,0.34),rgba(126,156,216,0.12))] bg-[length:220%_100%] animate-[shimmer_2.8s_linear_infinite]";

const ghostLineCreatingClass = "animate-[shimmer_1.6s_linear_infinite]";

const ghostLineTitleClass = "h-3.5 w-[42%] rounded-[5px]";

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

  function addDroppedFiles(event: DragEvent<HTMLFormElement>) {
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
      className={cx(appClass, isResizing && "app-resizing")}
      style={appStyle}
    >
      <section className={chatClass}>
        <header className={chatHeaderClass}>
          <div className={brandClass}>
            <h1 className={brandTitleClass}>Cairn</h1>
            <button
              type="button"
              className={cx(statusDotClass, statusDotToneClass[statusDot.tone])}
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
          className={messagesClass}
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className={emptyClass}>
              <button
                type="button"
                className={openFolderButtonClass}
                onClick={() => void openProjectDialog()}
                disabled={!ready}
              >
                Open Folder…
              </button>
              {recents.length > 0 && (
                <>
                  <p className={recentsLabelClass}>Recent</p>
                  <ul className={recentsListClass} aria-label="Recent projects">
                    {recents.map((recent) => (
                      <li key={recent.path}>
                        <button
                          type="button"
                          className={recentProjectClass}
                          aria-label={recent.displayName}
                          onClick={() => void openProject(recent.path)}
                          disabled={!ready}
                        >
                          <span className={recentNameClass}>
                            {recent.displayName}
                          </span>
                          <span className={recentPathClass}>{recent.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {projectOpenError && (
                <p className={openProjectErrorClass}>{projectOpenError}</p>
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
              <div key={m.id} className={messageRowClass[m.role]}>
                <div
                  className={cx(
                    messageBaseClass,
                    messageRoleClass[m.role],
                    recapClass,
                    isPendingAssistant && pendingMessageClass,
                  )}
                >
                  {isPendingAssistant ? (
                    <span
                      className={typingDotsClass}
                      role="status"
                      aria-label="Cairn is working"
                    >
                      <span className={typingDotClass} />
                      <span className={typingDotClass} />
                      <span className={typingDotClass} />
                    </span>
                  ) : (
                    <>
                      {(m.images?.length ?? 0) > 0 && (
                        <div className={messageImageStripClass}>
                          {chatMessageImagesWithKeys(m).map(
                            ({ image, key }) => (
                              <img
                                className={messageImageClass}
                                key={key}
                                src={image.dataUrl}
                                alt={image.mimeType}
                              />
                            ),
                          )}
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
          className={composerClass}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={addDroppedFiles}
        >
          {(composerAttachments.images.length > 0 ||
            composerAttachments.rejections.length > 0) && (
            <div className={attachmentPanelClass}>
              {composerAttachments.images.length > 0 && (
                <ul
                  className={attachmentListClass}
                  aria-label="Attached images"
                >
                  {composerAttachments.images.map((image) => (
                    <li className={attachmentChipClass} key={image.id}>
                      <img
                        className={attachmentImageClass}
                        src={image.dataUrl}
                        alt={image.mimeType}
                      />
                      <button
                        type="button"
                        className={attachmentRemoveButtonClass}
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
                <p className={attachmentRejectionClass} key={rejection.id}>
                  {rejection.fileName}:{" "}
                  {attachmentRejectionLabel(rejection.reason)}
                </p>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            className={composerTextareaClass}
            placeholder={ready ? "Type a message…" : "Waking up…"}
            value={input}
            onFocus={() => setRecapInteracted(true)}
            onChange={(e) => setInput(e.currentTarget.value)}
            onPaste={addPastedImages}
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
          <button
            type="submit"
            className={composerButtonClass}
            disabled={!canSend}
          >
            Send
          </button>
        </form>
      </section>

      {/* biome-ignore lint/a11y/useSemanticElements: The splitter is keyboard-focusable and owns a visual grip child. */}
      <div
        className={paneDividerClass}
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
        <span
          className={cx(
            paneDividerGripClass,
            isResizing && paneDividerGripActiveClass,
          )}
          aria-hidden="true"
        />
      </div>

      <aside className={panelClass}>
        <PanelTabs
          tabs={panelTabs}
          activeKey={activeTab}
          onSelect={(key) =>
            setActiveTab(
              key === "tasks" ? "tasks" : key === "plan" ? "plan" : "project",
            )
          }
        />
        <div className={panelBodyClass}>
          {showBriefArtifact ? (
            <div
              className={cx(
                "brief-artifact-shell",
                artifactShellClass,
                creating && "brief-artifact-shell-creating",
              )}
            >
              <BriefArtifactView data={projectBriefArtifact.data} />
              {creating && (
                <section
                  className={panelCreatingOverlayClass}
                  aria-live="polite"
                >
                  <p className={panelKickerClass}>Working draft</p>
                  <h2 className={panelOverlayTitleClass}>{creating.message}</h2>
                </section>
              )}
            </div>
          ) : showPlanArtifact ? (
            <div
              className={cx(
                "plan-artifact-shell",
                artifactShellClass,
                creating && "plan-artifact-shell-creating",
              )}
            >
              <PlanArtifactView data={projectPlanArtifact.data} />
              {creating && (
                <section
                  className={panelCreatingOverlayClass}
                  aria-live="polite"
                >
                  <p className={panelKickerClass}>Working draft</p>
                  <h2 className={panelOverlayTitleClass}>{creating.message}</h2>
                </section>
              )}
            </div>
          ) : showTasksArtifact ? (
            <div
              className={cx(
                "tasks-artifact-shell",
                artifactShellClass,
                creating && "tasks-artifact-shell-creating",
              )}
            >
              <TasksArtifactView data={projectTasksArtifact.data} />
              {creating && (
                <section
                  className={panelCreatingOverlayClass}
                  aria-live="polite"
                >
                  <p className={panelKickerClass}>Working draft</p>
                  <h2 className={panelOverlayTitleClass}>{creating.message}</h2>
                </section>
              )}
            </div>
          ) : showPlanEmptyState ? (
            <section
              className={cx(
                panelPlaceholderClass,
                placeholderCreating && "panel-placeholder-creating",
              )}
            >
              <p className={panelKickerClass}>
                {placeholderCreating ? "Working draft" : "Plan"}
              </p>
              <h2
                className={cx(
                  panelPlaceholderTitleClass,
                  placeholderCreating && panelPlaceholderCreatingTitleClass,
                )}
              >
                {placeholderCreating
                  ? placeholderCreating.message
                  : "Once we agree on what to build first, the plan will show up here."}
              </h2>
              <div
                className={cx(
                  panelGhostClass,
                  placeholderCreating && panelGhostCreatingClass,
                )}
              >
                <div
                  className={cx(
                    ghostLineClass,
                    ghostLineTitleClass,
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-full",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-[76%]",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-full",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-[58%]",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
              </div>
            </section>
          ) : (
            <section
              className={cx(
                panelPlaceholderClass,
                placeholderCreating && "panel-placeholder-creating",
              )}
            >
              <p className={panelKickerClass}>Working draft</p>
              <h2
                className={cx(
                  panelPlaceholderTitleClass,
                  placeholderCreating && panelPlaceholderCreatingTitleClass,
                )}
              >
                {placeholderCreating
                  ? placeholderCreating.message
                  : "Your project will show up here as we talk."}
              </h2>
              {!placeholderCreating && (
                <p className={panelEmptyClass}>
                  As the conversation sharpens, this panel will turn your
                  answers into a short readable plan.
                </p>
              )}
              <div
                className={cx(
                  panelGhostClass,
                  placeholderCreating && panelGhostCreatingClass,
                )}
              >
                <div
                  className={cx(
                    ghostLineClass,
                    ghostLineTitleClass,
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-full",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-[76%]",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-full",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
                <div
                  className={cx(
                    ghostLineClass,
                    "w-[58%]",
                    placeholderCreating && ghostLineCreatingClass,
                  )}
                />
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
