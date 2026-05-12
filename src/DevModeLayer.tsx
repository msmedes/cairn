import { useState } from "react";
import type { ChatMessage } from "./chat-stream";
import { useModalOverlay } from "./useModalOverlay";
import type { JsonValue, SidecarDevLogEntry } from "./useSidecarDevLog";

type DevModeLayerProps = {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  events: SidecarDevLogEntry[];
  onEventsCleared: () => void;
};

type DevPanel = "timeline" | "tools" | "messages" | "raw";
type DevEventKind =
  | "assistant"
  | "user"
  | "tool"
  | "subagent"
  | "project"
  | "system";
type AgentFilterId = "all" | string;
type AgentThread = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "cairn" | "subagent";
  sessionFile?: string;
};
type SessionLocation = {
  sessionFile: string;
  sessionDir?: string;
  projectPath?: string;
};
type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const PANEL_OPTIONS: Array<{ value: DevPanel; label: string }> = [
  { value: "timeline", label: "Timeline" },
  { value: "tools", label: "Tools" },
  { value: "messages", label: "Messages" },
  { value: "raw", label: "Raw" },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const chevronClass =
  "transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]";

const fieldClass = "dev-field grid min-w-0 grid-rows-[auto_auto] gap-1.5";

const fieldLabelClass =
  "text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-kanagawa-text-soft";

const fieldControlClass =
  "min-h-[38px] w-full min-w-0 cursor-pointer rounded-md border-0 bg-[rgba(22,22,29,0.72)] px-3 py-0 font-[inherit] text-sm font-medium text-kanagawa-text outline outline-1 outline-[var(--line)] transition-[background-color,outline-color,box-shadow] duration-180 ease-in placeholder:text-kanagawa-text-soft hover:bg-[rgba(31,31,40,0.85)] focus:bg-[rgba(31,31,40,0.95)] focus:shadow-[inset_0_0_0_1px_rgba(126,156,216,0.46),0_0_0_3px_rgba(126,156,216,0.18)] focus:outline-none";

const selectWrapClass = "relative min-w-0";

const selectClass = `${fieldControlClass} appearance-none truncate pr-10 [-webkit-appearance:none]`;

const selectChevronClass =
  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-kanagawa-text-soft";

const devLayerClass =
  "dev-layer fixed inset-0 z-20 grid min-h-0 text-kanagawa-text antialiased [--dev-pad-x:clamp(20px,4vw,48px)] [grid-template-rows:auto_auto_auto_auto_auto_minmax(0,1fr)] bg-[radial-gradient(circle_at_12%_-10%,rgba(126,156,216,0.14),transparent_38%),radial-gradient(circle_at_92%_6%,rgba(255,160,102,0.08),transparent_32%),linear-gradient(180deg,#181821_0%,#101016_100%)] [-moz-osx-font-smoothing:grayscale] animate-[dev-layer-in_220ms_cubic-bezier(0.2,0,0,1)_both] max-[980px]:[--dev-pad-x:18px] max-[640px]:[--dev-pad-x:14px]";

const devHeaderClass =
  "dev-layer-header flex items-center justify-between gap-6 px-[var(--dev-pad-x)] pb-[18px] pt-[22px] animate-[dev-section-rise_320ms_cubic-bezier(0.2,0,0,1)_both] max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-3.5";

const devKickerClass =
  "dev-layer-kicker mb-1.5 mt-0 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-kanagawa-accent";

const devTitleClass =
  "m-0 text-balance font-serif text-2xl font-semibold leading-[1.05] tracking-[-0.025em] text-kanagawa-text";

const devActionsClass =
  "dev-layer-actions inline-flex items-center gap-2 max-[640px]:items-stretch";

const devActionButtonClass =
  "min-h-9 min-w-[72px] cursor-pointer rounded-md border-0 bg-[rgba(42,42,55,0.7)] px-3.5 py-0 font-[inherit] text-[0.86rem] font-semibold text-kanagawa-text-muted transition-[background-color,color,transform,box-shadow] duration-[180ms,180ms,120ms,180ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1),ease] hover:bg-[rgba(50,50,66,0.96)] hover:text-kanagawa-text focus-visible:bg-[rgba(50,50,66,0.96)] focus-visible:text-kanagawa-text focus-visible:shadow-[0_0_0_3px_rgba(126,156,216,0.22)] focus-visible:outline-none max-[640px]:flex-1";

const metricsClass =
  "dev-metrics m-0 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2.5 px-[var(--dev-pad-x)] pb-3.5 pt-1.5 animate-[dev-section-rise_360ms_cubic-bezier(0.2,0,0,1)_60ms_both] max-[640px]:grid-cols-1";

const metricCardClass =
  "min-w-0 rounded-md bg-[rgba(31,31,40,0.62)] px-3.5 py-3 outline outline-1 outline-[var(--line)]";

const metricValueClass =
  "mt-1 mb-0 overflow-hidden text-ellipsis whitespace-nowrap font-serif text-[1.45rem] font-semibold leading-none tracking-[-0.02em] text-kanagawa-text tabular-nums";

const sessionLocationClass =
  "dev-session-location grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 px-[var(--dev-pad-x)] pb-3.5 pt-0 animate-[dev-section-rise_370ms_cubic-bezier(0.2,0,0,1)_90ms_both] max-[640px]:grid-cols-1";

const sessionLocationCopyClass = "grid min-w-0 gap-1.5";

const sessionFileClass =
  "block min-h-[38px] min-w-0 overflow-x-auto whitespace-nowrap rounded-md bg-[rgba(22,22,29,0.72)] px-3 py-2.5 font-mono text-[0.78rem] leading-[1.35] text-kanagawa-text outline outline-1 outline-[var(--line)]";

const sessionCopyButtonClass =
  "min-h-[38px] cursor-pointer rounded-md border-0 bg-[rgba(31,31,40,0.78)] px-3.5 py-0 font-[inherit] text-[0.82rem] font-bold text-kanagawa-text outline outline-1 outline-[var(--line)] transition-[background-color,outline-color,transform] duration-160 ease-in hover:bg-[rgba(42,42,54,0.92)] focus-visible:bg-[rgba(42,42,54,0.92)] active:scale-[0.96]";

const controlsClass =
  "dev-controls grid grid-cols-[minmax(220px,1fr)_minmax(280px,1fr)] gap-3 px-[var(--dev-pad-x)] pb-3.5 pt-1 animate-[dev-section-rise_380ms_cubic-bezier(0.2,0,0,1)_120ms_both] max-[640px]:grid-cols-1";

const tabsClass =
  "dev-tabs flex gap-1 px-[var(--dev-pad-x)] pb-3.5 pt-0 animate-[dev-section-rise_400ms_cubic-bezier(0.2,0,0,1)_180ms_both]";

const tabClass =
  "dev-tab relative min-h-9 cursor-pointer rounded-md border-0 bg-transparent px-3.5 py-0 font-[inherit] text-[0.86rem] font-semibold tracking-[-0.005em] text-kanagawa-text-soft transition-[background-color,color,transform,box-shadow] duration-[180ms,180ms,120ms,180ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1),ease] hover:bg-[rgba(42,42,55,0.6)] hover:text-kanagawa-text focus-visible:bg-[rgba(42,42,55,0.6)] focus-visible:text-kanagawa-text focus-visible:shadow-[0_0_0_3px_rgba(126,156,216,0.22)] focus-visible:outline-none";

const activeTabClass =
  "dev-tab-active bg-[rgba(126,156,216,0.18)] text-kanagawa-text shadow-[inset_0_0_0_1px_rgba(126,156,216,0.32),0_1px_0_rgba(255,255,255,0.04)] hover:bg-[rgba(126,156,216,0.18)] hover:text-kanagawa-text";

const devBodyClass =
  "dev-layer-body min-h-0 overflow-auto px-[var(--dev-pad-x)] pb-8 pt-1 animate-[dev-section-rise_460ms_cubic-bezier(0.2,0,0,1)_240ms_both]";

const listClass = "m-0 grid list-none gap-2 p-0";

const emptyClass =
  "dev-empty rounded-md bg-[rgba(31,31,40,0.62)] p-[22px] text-center text-[0.92rem] text-kanagawa-text-soft shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.18)]";

const eventRowClass =
  "dev-event relative grid grid-cols-[78px_minmax(0,1fr)] gap-3.5 overflow-hidden rounded-md bg-[rgba(31,31,40,0.62)] py-3 pr-3.5 pl-4 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.18)] max-[640px]:grid-cols-1";

const eventAccentClass: Record<DevEventKind, string> = {
  assistant: "bg-kanagawa-accent",
  user: "bg-kanagawa-yellow",
  tool: "bg-kanagawa-green",
  subagent: "bg-kanagawa-warm",
  project: "bg-kanagawa-magenta",
  system: "bg-kanagawa-text-soft",
};

const eventTimeClass =
  "font-mono text-[0.74rem] tracking-[-0.01em] text-kanagawa-text-soft tabular-nums";

const eventContentClass = "dev-event-content min-w-0";

const eventHeaderClass =
  "dev-event-header-row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3";

const eventSummaryClass = "dev-event-summary min-w-0";

const eventTitleClass =
  "block text-[0.92rem] font-semibold leading-[1.3] tracking-[-0.005em] text-kanagawa-text";

const tokenChipClass =
  "dev-token-chip mt-1.5 inline-block rounded-full bg-[rgba(22,22,29,0.72)] px-2 py-0.5 font-mono text-[0.72rem] leading-[1.35] text-kanagawa-text-soft tabular-nums";

const eventTextClass =
  "mt-1 mb-0 [overflow-wrap:anywhere] text-[0.86rem] leading-[1.45] text-kanagawa-text-muted [text-wrap:pretty]";

const eventToggleClass =
  "dev-event-toggle relative grid min-h-8 w-8 min-w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-kanagawa-text-soft transition-[background-color,color,transform] duration-[180ms,180ms,120ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1)] before:absolute before:-inset-1 before:content-[''] hover:bg-[rgba(50,50,66,0.72)] hover:text-kanagawa-text focus-visible:bg-[rgba(50,50,66,0.72)] focus-visible:text-kanagawa-text focus-visible:shadow-[0_0_0_3px_rgba(126,156,216,0.22)] focus-visible:outline-none";

const eventDetailsClass =
  "dev-event-details mt-3.5 grid gap-3 border-t border-[rgba(220,215,186,0.08)] pt-3.5";

const detailClass = "dev-detail min-w-0";

const detailHeadingClass =
  "mb-1.5 mt-0 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-kanagawa-text-soft";

const detailTextClass =
  "m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[0.78rem] leading-[1.5] text-kanagawa-text-muted";

const detailPreClass =
  "m-0 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md bg-[rgba(12,12,17,0.7)] p-3 font-mono text-[0.78rem] leading-[1.5] text-kanagawa-text-muted shadow-[inset_0_0_0_1px_rgba(220,215,186,0.06)] [overflow-wrap:anywhere]";

const messageClass =
  "dev-message rounded-md bg-[rgba(31,31,40,0.62)] px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.18)]";

const messageRoleClass = {
  user: "bg-[rgba(45,79,103,0.36)]",
  assistant: "bg-[rgba(42,42,55,0.74)]",
} as const;

const messageTextClass =
  "mt-1 mb-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-[0.86rem] leading-[1.45] text-kanagawa-text-muted [text-wrap:pretty]";

const rawItemClass =
  "grid gap-2.5 rounded-md bg-[rgba(31,31,40,0.62)] p-3.5 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.18)]";

const rawPreClass =
  "m-0 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[0.78rem] leading-[1.5] text-kanagawa-text-muted [overflow-wrap:anywhere]";

function isObject(value: JsonValue | undefined): value is {
  [key: string]: JsonValue;
} {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: JsonValue | undefined) {
  return typeof value === "boolean" ? value : null;
}

function arrayValue(value: JsonValue | undefined) {
  return Array.isArray(value) ? value : null;
}

function numberValue(value: JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  const second = date.getSeconds().toString().padStart(2, "0");
  return `${hour}:${minute}:${second}`;
}

function truncate(value: string, maxLength = 220) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}...`;
}

function extractTextContent(content: JsonValue | undefined) {
  const directText = stringValue(content);
  if (directText) return directText;

  const parts = arrayValue(content);
  if (!parts) return null;

  const text = parts
    .flatMap((part) => {
      if (!isObject(part)) return [];
      if (part.type === "text") {
        const textPart = stringValue(part.text);
        return textPart ? [textPart] : [];
      }
      return [];
    })
    .join("");

  return text || null;
}

function extractToolCalls(content: JsonValue | undefined) {
  const parts = arrayValue(content);
  if (!parts) return [];

  return parts.flatMap((part) => {
    if (!isObject(part) || part.type !== "toolCall") return [];
    const name = stringValue(part.name) ?? stringValue(part.toolName);
    if (!name) return [];
    return [
      {
        name,
        args: part.arguments ?? part.args ?? null,
      },
    ];
  });
}

function isToolPayload(payload: JsonValue) {
  if (!isObject(payload)) return false;
  const type = stringValue(payload.type);
  if (type === "tool_start" || type === "tool_end") return true;

  if (type !== "session_event" || !isObject(payload.event)) return false;

  const event = payload.event;
  const eventType = stringValue(event.type);
  if (eventType?.startsWith("tool_execution_")) return true;
  if (!eventType?.startsWith("message_") || !isObject(event.message)) {
    return false;
  }

  const role = stringValue(event.message.role);
  return (
    role === "toolResult" ||
    stringValue(event.message.toolName) !== null ||
    extractToolCalls(event.message.content).length > 0
  );
}

function sourceKind(payload: JsonValue) {
  if (!isObject(payload) || !isObject(payload.source)) return null;
  return stringValue(payload.source.kind);
}

function sourceAgentId(payload: JsonValue) {
  if (!isObject(payload) || !isObject(payload.source)) return "cairn";
  return stringValue(payload.source.agentId) ?? "cairn";
}

function formatJsonInline(value: JsonValue | undefined) {
  if (value === undefined || value === null) return null;
  return truncate(JSON.stringify(value), 320);
}

function formatJsonBlock(value: JsonValue | undefined) {
  if (value === undefined) return null;
  return JSON.stringify(value, null, 2);
}

function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokenUsage(left: TokenUsage, right: TokenUsage) {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

function tokenUsageFromUsageObject(value: JsonValue | undefined) {
  if (!isObject(value)) return null;
  const usage: TokenUsage = {
    input: numberValue(value.input) ?? 0,
    output: numberValue(value.output) ?? 0,
    cacheRead: numberValue(value.cacheRead) ?? 0,
    cacheWrite: numberValue(value.cacheWrite) ?? 0,
  };
  return usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0
    ? usage
    : null;
}

function tokenUsageForPayload(payload: JsonValue) {
  if (!isObject(payload)) return null;

  const directUsage = tokenUsageFromUsageObject(payload.usage);
  if (directUsage) return directUsage;

  if (
    payload.type === "session_event" &&
    isObject(payload.event) &&
    isObject(payload.event.message)
  ) {
    return tokenUsageFromUsageObject(payload.event.message.usage);
  }

  return null;
}

function sumTokenUsage(events: SidecarDevLogEntry[]) {
  return events.reduce((total, event) => {
    const usage = tokenUsageForPayload(event.payload);
    return usage ? addTokenUsage(total, usage) : total;
  }, emptyTokenUsage());
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCompactNumber(value: number) {
  if (value < 10_000) return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cx(chevronClass, open && "rotate-180")}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.75 5.25 7 8.5l3.25-3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatTokenUsage(usage: TokenUsage) {
  const cached = usage.cacheRead + usage.cacheWrite;
  return `in ${formatNumber(usage.input)} / out ${formatNumber(usage.output)} / cached ${formatNumber(cached)}`;
}

function roleLabel(role: string) {
  return role === "toolResult" ? "tool result" : role;
}

function includesSpawnSubagent(payload: JsonValue) {
  return JSON.stringify(payload).includes("spawn_subagent");
}

function eventKind(payload: JsonValue): DevEventKind {
  if (!isObject(payload)) return "system";
  if (sourceKind(payload) === "subagent") return "subagent";
  if (includesSpawnSubagent(payload)) return "subagent";

  const type = stringValue(payload.type);
  if (type === "project_state") return "project";
  if (type === "tool_start" || type === "tool_end") return "tool";

  if (type === "session_event" && isObject(payload.event)) {
    const event = payload.event;
    const eventType = stringValue(event.type);
    if (eventType?.startsWith("tool_execution_")) return "tool";
    if (eventType?.startsWith("message_") && isObject(event.message)) {
      const role = stringValue(event.message.role);
      const toolName = stringValue(event.message.toolName);
      if (toolName === "spawn_subagent") return "subagent";
      if (toolName) return "tool";
      if (
        role === "assistant" &&
        extractToolCalls(event.message.content).length > 0
      ) {
        return includesSpawnSubagent(event.message.content)
          ? "subagent"
          : "tool";
      }
      if (role === "user") return "user";
      if (role === "assistant") return "assistant";
      if (role === "toolResult") return "tool";
    }
    if (eventType === "message_update") return "assistant";
  }

  if (type === "assistant_error") return "assistant";
  return "system";
}

function summarizeSessionEvent(event: { [key: string]: JsonValue }) {
  const eventType = stringValue(event.type) ?? "session_event";

  switch (eventType) {
    case "message_start": {
      const role = isObject(event.message)
        ? (stringValue(event.message.role) ?? "message")
        : "message";
      return {
        title: `${role} started`,
        detail:
          role === "assistant" && isObject(event.message)
            ? stringValue(event.message.model)
            : null,
      };
    }
    case "message_update": {
      const assistantEvent = isObject(event.assistantMessageEvent)
        ? event.assistantMessageEvent
        : null;
      const assistantEventType =
        stringValue(assistantEvent?.type) ?? "assistant update";
      const delta = stringValue(assistantEvent?.delta);
      return {
        title: assistantEventType,
        detail: delta ? truncate(delta) : null,
      };
    }
    case "message_end": {
      if (!isObject(event.message)) {
        return { title: "message ended", detail: null };
      }
      const role = stringValue(event.message.role) ?? "message";
      const text = extractTextContent(event.message.content);
      const toolName = stringValue(event.message.toolName);
      const toolCalls = extractToolCalls(event.message.content);
      if (toolCalls.length > 0) {
        const first = toolCalls[0];
        const label =
          first.name === "spawn_subagent" ? "subagent fork" : "tool call";
        const extra =
          toolCalls.length > 1 ? ` and ${toolCalls.length - 1} more` : "";
        return {
          title: `${label}: ${first.name}${extra}`,
          detail: formatJsonInline(first.args),
        };
      }
      return {
        title: toolName
          ? `${roleLabel(role)}: ${toolName}`
          : `${roleLabel(role)} ended`,
        detail: text ? truncate(text) : null,
      };
    }
    case "tool_execution_start":
      return {
        title: `tool started: ${stringValue(event.toolName) ?? "unknown"}`,
        detail: null,
      };
    case "tool_execution_end": {
      const ok = !booleanValue(event.isError);
      return {
        title: `tool ended: ${stringValue(event.toolName) ?? "unknown"}`,
        detail: ok ? "ok" : "error",
      };
    }
    case "agent_end": {
      const count = arrayValue(event.messages)?.length ?? 0;
      return {
        title: "agent ended",
        detail: `${count} messages in final state`,
      };
    }
    case "turn_end": {
      const count = arrayValue(event.toolResults)?.length ?? 0;
      return {
        title: "turn ended",
        detail: `${count} tool results`,
      };
    }
    default:
      return { title: eventType, detail: null };
  }
}

function summarizePayload(payload: JsonValue) {
  if (!isObject(payload)) {
    return { title: "dev log", detail: JSON.stringify(payload) };
  }

  const type = stringValue(payload.type) ?? "dev log";
  const source = sourceKind(payload);

  switch (type) {
    case "session_event": {
      const summary = isObject(payload.event)
        ? summarizeSessionEvent(payload.event)
        : { title: "session event", detail: null };
      return source === "subagent"
        ? { ...summary, title: `subagent ${summary.title}` }
        : summary;
    }
    case "project_state": {
      const phase = stringValue(payload.phase) ?? "unknown";
      const prds = arrayValue(payload.prds)?.length ?? 0;
      const issues = arrayValue(payload.issues)?.length ?? 0;
      return {
        title: "project state",
        detail: `phase ${phase}, ${prds} PRDs, ${issues} issues`,
      };
    }
    case "tool_start":
      return {
        title: `tool started: ${stringValue(payload.name) ?? "unknown"}`,
        detail: null,
      };
    case "tool_end": {
      const ok = booleanValue(payload.ok);
      return {
        title: `tool ended: ${stringValue(payload.name) ?? "unknown"}`,
        detail: ok === null ? null : ok ? "ok" : "error",
      };
    }
    case "assistant_error":
      return {
        title: "assistant error",
        detail: stringValue(payload.message),
      };
    default:
      return { title: type, detail: null };
  }
}

function extractAgentThreads(events: SidecarDevLogEntry[]): AgentThread[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index].payload;
    if (!isObject(payload) || payload.type !== "agent_threads") continue;
    const rawThreads = arrayValue(payload.threads);
    if (!rawThreads) continue;
    const threads = rawThreads.flatMap((raw): AgentThread[] => {
      if (!isObject(raw)) return [];
      const id = stringValue(raw.id);
      const label = stringValue(raw.label);
      const kind = stringValue(raw.kind);
      if (!id || !label || (kind !== "cairn" && kind !== "subagent")) {
        return [];
      }
      const parentId = stringValue(raw.parentId);
      return [
        {
          id,
          label,
          kind,
          parentId,
          sessionFile: stringValue(raw.sessionFile) ?? undefined,
        },
      ];
    });
    if (threads.length > 0) return threads;
  }

  return [{ id: "cairn", parentId: null, label: "Cairn", kind: "cairn" }];
}

function extractSessionLocation(
  events: SidecarDevLogEntry[],
): SessionLocation | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index].payload;
    if (!isObject(payload)) continue;
    if (payload.type === "session_location") {
      const sessionFile = stringValue(payload.sessionFile);
      if (!sessionFile) continue;
      return {
        sessionFile,
        sessionDir: stringValue(payload.sessionDir) ?? undefined,
        projectPath: stringValue(payload.projectPath) ?? undefined,
      };
    }
    if (payload.type === "agent_threads") {
      const rawThreads = arrayValue(payload.threads);
      const rawParent = rawThreads?.find(
        (thread) => isObject(thread) && stringValue(thread.id) === "cairn",
      );
      if (!isObject(rawParent)) continue;
      const sessionFile = stringValue(rawParent.sessionFile);
      if (sessionFile) return { sessionFile };
    }
  }

  return null;
}

function eventMatchesAgentFilter(
  event: SidecarDevLogEntry,
  selectedAgentId: AgentFilterId,
) {
  if (selectedAgentId === "all") return true;
  return sourceAgentId(event.payload) === selectedAgentId;
}

function formatRawJson(value: JsonValue) {
  return JSON.stringify(value, null, 2);
}

type DevDetail = {
  label: string;
  value: string;
  isCode?: boolean;
};

function formatSubagentPrompt(args: JsonValue | undefined) {
  if (!isObject(args)) return null;
  const skillName = stringValue(args.skill_name) ?? stringValue(args.skillName);
  if (!skillName) return null;
  const skillArgs = args.args;
  const formattedArgs =
    skillArgs === undefined ? "" : ` ${JSON.stringify(skillArgs, null, 2)}`;
  return `/skill:${skillName}${formattedArgs}`;
}

function sourceDetail(payload: JsonValue) {
  if (!isObject(payload) || !isObject(payload.source)) return "cairn";
  const source = payload.source;
  const parts = [
    `kind=${stringValue(source.kind) ?? "unknown"}`,
    `agent=${stringValue(source.agentId) ?? "cairn"}`,
  ];
  const parentAgentId = stringValue(source.parentAgentId);
  if (parentAgentId) parts.push(`parent=${parentAgentId}`);
  const sessionFile = stringValue(source.sessionFile);
  if (sessionFile) parts.push(`session=${sessionFile}`);
  return parts.join("\n");
}

function detailsForPayload(payload: JsonValue): DevDetail[] {
  const details: DevDetail[] = [
    { label: "Source", value: sourceDetail(payload) },
  ];

  if (isObject(payload)) {
    if (payload.type === "session_event" && isObject(payload.event)) {
      const event = payload.event;
      const timestamp = stringValue(event.timestamp);
      if (timestamp) {
        details.push({ label: "Original Timestamp", value: timestamp });
      }

      if (isObject(event.message)) {
        const message = event.message;
        const role = stringValue(message.role);
        if (role) details.push({ label: "Message Role", value: role });

        const usage = tokenUsageFromUsageObject(message.usage);
        if (usage) {
          details.push({
            label: "Token Usage",
            value: formatTokenUsage(usage),
          });
        }

        const text = extractTextContent(message.content);
        if (text) details.push({ label: "Message Text", value: text });

        const toolName = stringValue(message.toolName);
        if (toolName) details.push({ label: "Tool Name", value: toolName });

        const toolCalls = extractToolCalls(message.content);
        toolCalls.forEach((toolCall, index) => {
          const number = toolCalls.length > 1 ? ` ${index + 1}` : "";
          details.push({ label: `Tool Call${number}`, value: toolCall.name });
          const args = formatJsonBlock(toolCall.args);
          if (args) {
            details.push({
              label: `Tool Arguments${number}`,
              value: args,
              isCode: true,
            });
          }
          if (toolCall.name === "spawn_subagent") {
            const prompt = formatSubagentPrompt(toolCall.args);
            if (prompt) {
              details.push({
                label: "Subagent Prompt",
                value: prompt,
                isCode: true,
              });
            }
            if (isObject(toolCall.args) && toolCall.args.response_schema) {
              const schema = formatJsonBlock(toolCall.args.response_schema);
              if (schema) {
                details.push({
                  label: "Subagent Response Schema",
                  value: schema,
                  isCode: true,
                });
              }
            }
          }
        });
      }

      const toolName = stringValue(event.toolName);
      if (toolName) details.push({ label: "Tool Event Name", value: toolName });
      const errorMessage = stringValue(event.errorMessage);
      if (errorMessage) {
        details.push({ label: "Tool Error", value: errorMessage });
      }
    }

    if (payload.type === "tool_start" || payload.type === "tool_end") {
      const toolName = stringValue(payload.name);
      if (toolName) details.push({ label: "Tool Name", value: toolName });
      const args = formatJsonBlock(payload.args);
      if (args) details.push({ label: "Arguments", value: args, isCode: true });
      const result = formatJsonBlock(payload.result);
      if (result)
        details.push({ label: "Result", value: result, isCode: true });
    }
  }

  details.push({
    label: "Raw Event",
    value: formatRawJson(payload),
    isCode: true,
  });
  return details;
}

function textMatchesSearch(value: string, searchQuery: string) {
  const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const normalized = value.toLowerCase();
  return terms.every((term) => normalized.includes(term));
}

function eventSearchText(event: SidecarDevLogEntry) {
  const summary = summarizePayload(event.payload);
  const details = detailsForPayload(event.payload);
  return [
    event.id,
    event.receivedAt,
    summary.title,
    summary.detail ?? "",
    ...details.flatMap((detail) => [detail.label, detail.value]),
  ].join("\n");
}

function eventMatchesSearch(event: SidecarDevLogEntry, searchQuery: string) {
  return textMatchesSearch(eventSearchText(event), searchQuery);
}

function messageMatchesSearch(message: ChatMessage, searchQuery: string) {
  return textMatchesSearch(`${message.role}\n${message.text}`, searchQuery);
}

type AgentSelectProps = {
  threads: AgentThread[];
  selectedAgentId: AgentFilterId;
  events: SidecarDevLogEntry[];
  onAgentSelected: (agentId: AgentFilterId) => void;
};

function agentDepth(threads: AgentThread[], thread: AgentThread) {
  let depth = 0;
  let parentId = thread.parentId;
  while (parentId) {
    const parent = threads.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

function AgentSelect({
  threads,
  selectedAgentId,
  events,
  onAgentSelected,
}: AgentSelectProps) {
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    const agentId = sourceAgentId(event.payload);
    eventCounts.set(agentId, (eventCounts.get(agentId) ?? 0) + 1);
  }

  return (
    <label className={fieldClass}>
      <span className={fieldLabelClass}>Agent</span>
      <div className={selectWrapClass}>
        <select
          className={selectClass}
          value={selectedAgentId}
          onChange={(event) => onAgentSelected(event.currentTarget.value)}
        >
          <option value="all">All agents ({events.length})</option>
          {threads.map((thread) => {
            const depth = agentDepth(threads, thread);
            const prefix = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
            return (
              <option key={thread.id} value={thread.id}>
                {prefix}
                {thread.label} ({eventCounts.get(thread.id) ?? 0})
              </option>
            );
          })}
        </select>
        <span className={selectChevronClass} aria-hidden="true">
          <ChevronIcon open={false} />
        </span>
      </div>
    </label>
  );
}

type DevEventRowProps = {
  event: SidecarDevLogEntry;
};

function DevEventRow({ event }: DevEventRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = summarizePayload(event.payload);
  const kind = eventKind(event.payload);
  const details = detailsForPayload(event.payload);
  const usage = tokenUsageForPayload(event.payload);

  return (
    <li className={eventRowClass}>
      <span
        className={cx(
          "absolute inset-y-0 left-0 w-[3px] rounded-l-md",
          eventAccentClass[kind],
        )}
        aria-hidden="true"
      />
      <time className={eventTimeClass} dateTime={event.receivedAt}>
        {formatTime(event.receivedAt)}
      </time>
      <div className={eventContentClass}>
        <div className={eventHeaderClass}>
          <div className={eventSummaryClass}>
            <strong className={eventTitleClass}>{summary.title}</strong>
            {usage && (
              <span className={tokenChipClass}>{formatTokenUsage(usage)}</span>
            )}
            {summary.detail && (
              <p className={eventTextClass}>{summary.detail}</p>
            )}
          </div>
          <button
            type="button"
            className={eventToggleClass}
            aria-label={isExpanded ? "Collapse event" : "Expand event"}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            <ChevronIcon open={isExpanded} />
          </button>
        </div>

        {isExpanded && (
          <div className={eventDetailsClass}>
            {details.map((detail) => (
              <section key={detail.label} className={detailClass}>
                <h3 className={detailHeadingClass}>{detail.label}</h3>
                {detail.isCode ? (
                  <pre className={detailPreClass}>{detail.value}</pre>
                ) : (
                  <p className={detailTextClass}>{detail.value}</p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function DevModeLayer({
  isOpen,
  onClose,
  messages,
  events,
  onEventsCleared,
}: DevModeLayerProps) {
  const [activePanel, setActivePanel] = useState<DevPanel>("timeline");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentFilterId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedSessionFile, setCopiedSessionFile] = useState(false);
  const overlayRef = useModalOverlay<HTMLElement>(isOpen, onClose);
  const agentThreads = extractAgentThreads(events);
  const sessionLocation = extractSessionLocation(events);
  const filteredEvents = events.filter((event) =>
    eventMatchesAgentFilter(event, selectedAgentId),
  );
  const searchedEvents = filteredEvents.filter((event) =>
    eventMatchesSearch(event, searchQuery),
  );
  const latestEvents = searchedEvents.slice().reverse();
  const latestToolEvents = filteredEvents
    .filter((event) => eventMatchesSearch(event, searchQuery))
    .filter((event) => isToolPayload(event.payload))
    .slice()
    .reverse();
  const filteredMessages = messages.filter((message) =>
    messageMatchesSearch(message, searchQuery),
  );
  const sessionTokenTotals = sumTokenUsage(events);
  const hasSearch = searchQuery.trim().length > 0;
  const copySessionFile = async () => {
    if (!sessionLocation) return;
    await navigator.clipboard?.writeText(sessionLocation.sessionFile);
    setCopiedSessionFile(true);
    window.setTimeout(() => setCopiedSessionFile(false), 1200);
  };

  if (!isOpen) return null;

  return (
    <section
      ref={overlayRef}
      className={devLayerClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-layer-heading"
      tabIndex={-1}
    >
      <header className={devHeaderClass}>
        <div>
          <p className={devKickerClass}>Under the hood</p>
          <h2 className={devTitleClass} id="dev-layer-heading">
            Session Debug
          </h2>
        </div>
        <div className={devActionsClass}>
          <button
            type="button"
            className={devActionButtonClass}
            onClick={onEventsCleared}
          >
            Clear
          </button>
          <button
            type="button"
            className={devActionButtonClass}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      <dl className={metricsClass}>
        <div className={metricCardClass}>
          <dt className={fieldLabelClass}>New input</dt>
          <dd
            className={metricValueClass}
            title={formatNumber(sessionTokenTotals.input)}
          >
            {formatCompactNumber(sessionTokenTotals.input)}
          </dd>
        </div>
        <div className={metricCardClass}>
          <dt className={fieldLabelClass}>Cache read</dt>
          <dd
            className={metricValueClass}
            title={formatNumber(sessionTokenTotals.cacheRead)}
          >
            {formatCompactNumber(sessionTokenTotals.cacheRead)}
          </dd>
        </div>
        <div className={metricCardClass}>
          <dt className={fieldLabelClass}>Cache write</dt>
          <dd
            className={metricValueClass}
            title={formatNumber(sessionTokenTotals.cacheWrite)}
          >
            {formatCompactNumber(sessionTokenTotals.cacheWrite)}
          </dd>
        </div>
        <div className={metricCardClass}>
          <dt className={fieldLabelClass}>Output</dt>
          <dd
            className={metricValueClass}
            title={formatNumber(sessionTokenTotals.output)}
          >
            {formatCompactNumber(sessionTokenTotals.output)}
          </dd>
        </div>
      </dl>

      {sessionLocation && (
        <section className={sessionLocationClass} aria-label="Chat location">
          <div className={sessionLocationCopyClass}>
            <span className={fieldLabelClass}>Chat JSONL</span>
            <code
              className={sessionFileClass}
              title={sessionLocation.sessionFile}
            >
              {sessionLocation.sessionFile}
            </code>
          </div>
          <button
            type="button"
            className={sessionCopyButtonClass}
            onClick={() => void copySessionFile()}
          >
            {copiedSessionFile ? "Copied" : "Copy"}
          </button>
        </section>
      )}

      <div className={controlsClass}>
        <AgentSelect
          threads={agentThreads}
          selectedAgentId={selectedAgentId}
          events={events}
          onAgentSelected={setSelectedAgentId}
        />
        <label className={fieldClass}>
          <span className={fieldLabelClass}>Search</span>
          <input
            className={fieldControlClass}
            type="search"
            value={searchQuery}
            placeholder="Filter events"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className={tabsClass} role="tablist" aria-label="Dev panels">
        {PANEL_OPTIONS.map((panel) => (
          <button
            key={panel.value}
            type="button"
            role="tab"
            aria-selected={activePanel === panel.value}
            className={cx(
              tabClass,
              activePanel === panel.value && activeTabClass,
            )}
            onClick={() => setActivePanel(panel.value)}
          >
            {panel.label}
          </button>
        ))}
      </div>

      <div className={devBodyClass}>
        {activePanel === "timeline" && (
          <ol className={listClass}>
            {latestEvents.length === 0 ? (
              <li className={emptyClass}>
                {hasSearch ? "No matching dev events." : "No dev events yet."}
              </li>
            ) : (
              latestEvents.map((event) => (
                <DevEventRow key={event.id} event={event} />
              ))
            )}
          </ol>
        )}

        {activePanel === "tools" && (
          <ol className={listClass}>
            {latestToolEvents.length === 0 ? (
              <li className={emptyClass}>
                {hasSearch ? "No matching tool calls." : "No tool calls yet."}
              </li>
            ) : (
              latestToolEvents.map((event) => (
                <DevEventRow key={event.id} event={event} />
              ))
            )}
          </ol>
        )}

        {activePanel === "messages" && (
          <ol className={listClass}>
            {filteredMessages.length === 0 ? (
              <li className={emptyClass}>
                {hasSearch
                  ? "No matching chat messages."
                  : "No chat messages yet."}
              </li>
            ) : (
              filteredMessages.map((message) => (
                <li
                  key={message.id}
                  className={cx(messageClass, messageRoleClass[message.role])}
                >
                  <span className={fieldLabelClass}>{message.role}</span>
                  <p className={messageTextClass}>
                    {message.text || (message.done ? "" : "...")}
                  </p>
                </li>
              ))
            )}
          </ol>
        )}

        {activePanel === "raw" && (
          <ol className={listClass}>
            {latestEvents.length === 0 ? (
              <li className={emptyClass}>
                {hasSearch ? "No matching raw events." : "No raw events yet."}
              </li>
            ) : (
              latestEvents.map((event) => (
                <li className={rawItemClass} key={event.id}>
                  <time className={eventTimeClass} dateTime={event.receivedAt}>
                    {formatTime(event.receivedAt)}
                  </time>
                  <pre className={rawPreClass}>
                    {formatRawJson(event.payload)}
                  </pre>
                </li>
              ))
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
