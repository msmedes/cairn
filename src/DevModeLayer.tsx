import { useState } from "react";
import type { ChatMessage } from "./chat-stream";
import type { JsonValue, SidecarDevLogEntry } from "./useSidecarDevLog";

type DevModeLayerProps = {
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
      className={`dev-event-chevron${open ? " dev-event-chevron-open" : ""}`}
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
    <label className="dev-field">
      <span>Agent</span>
      <select
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
    <li className={`dev-event dev-event-${kind}`}>
      <time dateTime={event.receivedAt}>{formatTime(event.receivedAt)}</time>
      <div className="dev-event-content">
        <div className="dev-event-header-row">
          <div className="dev-event-summary">
            <strong>{summary.title}</strong>
            {usage && (
              <span className="dev-token-chip">{formatTokenUsage(usage)}</span>
            )}
            {summary.detail && <p>{summary.detail}</p>}
          </div>
          <button
            type="button"
            className="dev-event-toggle"
            aria-label={isExpanded ? "Collapse event" : "Expand event"}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            <ChevronIcon open={isExpanded} />
          </button>
        </div>

        {isExpanded && (
          <div className="dev-event-details">
            {details.map((detail) => (
              <section key={detail.label} className="dev-detail">
                <h3>{detail.label}</h3>
                {detail.isCode ? (
                  <pre>{detail.value}</pre>
                ) : (
                  <p>{detail.value}</p>
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
  messages,
  events,
  onEventsCleared,
}: DevModeLayerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<DevPanel>("timeline");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentFilterId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const agentThreads = extractAgentThreads(events);
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

  return (
    <>
      <button
        type="button"
        className="dev-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        Dev
      </button>
      {isOpen && (
        <section className="dev-layer" aria-label="Developer mode">
          <header className="dev-layer-header">
            <div>
              <p className="dev-layer-kicker">Under the hood</p>
              <h2>Session Debug</h2>
            </div>
            <div className="dev-layer-actions">
              <button type="button" onClick={onEventsCleared}>
                Clear
              </button>
              <button type="button" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>
          </header>

          <dl className="dev-metrics">
            <div>
              <dt>New input</dt>
              <dd title={formatNumber(sessionTokenTotals.input)}>
                {formatCompactNumber(sessionTokenTotals.input)}
              </dd>
            </div>
            <div>
              <dt>Cache read</dt>
              <dd title={formatNumber(sessionTokenTotals.cacheRead)}>
                {formatCompactNumber(sessionTokenTotals.cacheRead)}
              </dd>
            </div>
            <div>
              <dt>Cache write</dt>
              <dd title={formatNumber(sessionTokenTotals.cacheWrite)}>
                {formatCompactNumber(sessionTokenTotals.cacheWrite)}
              </dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd title={formatNumber(sessionTokenTotals.output)}>
                {formatCompactNumber(sessionTokenTotals.output)}
              </dd>
            </div>
          </dl>

          <div className="dev-controls">
            <AgentSelect
              threads={agentThreads}
              selectedAgentId={selectedAgentId}
              events={events}
              onAgentSelected={setSelectedAgentId}
            />
            <label className="dev-field">
              <span>Search</span>
              <input
                type="search"
                value={searchQuery}
                placeholder="Filter events"
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </label>
          </div>

          <div className="dev-tabs" role="tablist" aria-label="Dev panels">
            {PANEL_OPTIONS.map((panel) => (
              <button
                key={panel.value}
                type="button"
                role="tab"
                aria-selected={activePanel === panel.value}
                className={`dev-tab${activePanel === panel.value ? " dev-tab-active" : ""}`}
                onClick={() => setActivePanel(panel.value)}
              >
                {panel.label}
              </button>
            ))}
          </div>

          <div className="dev-layer-body">
            {activePanel === "timeline" && (
              <ol className="dev-timeline">
                {latestEvents.length === 0 ? (
                  <li className="dev-empty">
                    {hasSearch
                      ? "No matching dev events."
                      : "No dev events yet."}
                  </li>
                ) : (
                  latestEvents.map((event) => (
                    <DevEventRow key={event.id} event={event} />
                  ))
                )}
              </ol>
            )}

            {activePanel === "tools" && (
              <ol className="dev-timeline">
                {latestToolEvents.length === 0 ? (
                  <li className="dev-empty">
                    {hasSearch
                      ? "No matching tool calls."
                      : "No tool calls yet."}
                  </li>
                ) : (
                  latestToolEvents.map((event) => (
                    <DevEventRow key={event.id} event={event} />
                  ))
                )}
              </ol>
            )}

            {activePanel === "messages" && (
              <ol className="dev-messages">
                {filteredMessages.length === 0 ? (
                  <li className="dev-empty">
                    {hasSearch
                      ? "No matching chat messages."
                      : "No chat messages yet."}
                  </li>
                ) : (
                  filteredMessages.map((message) => (
                    <li
                      key={message.id}
                      className={`dev-message dev-message-${message.role}`}
                    >
                      <span>{message.role}</span>
                      <p>{message.text || (message.done ? "" : "...")}</p>
                    </li>
                  ))
                )}
              </ol>
            )}

            {activePanel === "raw" && (
              <ol className="dev-raw-list">
                {latestEvents.length === 0 ? (
                  <li className="dev-empty">
                    {hasSearch
                      ? "No matching raw events."
                      : "No raw events yet."}
                  </li>
                ) : (
                  latestEvents.map((event) => (
                    <li key={event.id}>
                      <time dateTime={event.receivedAt}>
                        {formatTime(event.receivedAt)}
                      </time>
                      <pre>{formatRawJson(event.payload)}</pre>
                    </li>
                  ))
                )}
              </ol>
            )}
          </div>
        </section>
      )}
    </>
  );
}
