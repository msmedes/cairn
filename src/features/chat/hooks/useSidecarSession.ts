import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { hasTauriRuntime } from "../../../lib/tauri";
import {
  applyAssistantDelta,
  type ChatMessage,
  markAssistantDone,
} from "../chat-stream";

export type ActiveProject = {
  id: string;
  name: string;
  path: string;
  displayName: string;
};

export type RecentProject = {
  path: string;
  displayName: string;
  lastOpenedAt: string;
};

export type PromptImage = {
  data: string;
  mimeType: string;
  dataUrl: string;
};

export type QuestionOption = {
  label: string;
  description: string;
};

export type PendingQuestion = {
  toolCallId: string;
  questions: Array<{
    header: string;
    question: string;
    multiSelect?: boolean;
    options: QuestionOption[];
  }>;
};

export type QuestionAnswer =
  | {
      questionIndex: number;
      header: string;
      question: string;
      kind: "option";
      option: QuestionOption;
    }
  | {
      questionIndex: number;
      header: string;
      question: string;
      kind: "custom";
      answer: string;
    }
  | {
      questionIndex: number;
      header: string;
      question: string;
      kind: "multi";
      selected: string[];
    };

type SidecarEvent =
  | { type: "hydrate"; messages: ChatMessage[] }
  | { type: "active_project"; project: ActiveProject }
  | { type: "ready" }
  | { type: "recents"; entries: RecentProject[] }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | {
      type: "ask_user_question";
      toolCallId: string;
      questions: PendingQuestion["questions"];
    }
  | {
      type: "creating_started";
      target: "brief" | "prd" | "issues" | "plan" | "tasks";
      message: string;
    }
  | {
      type: "mcp_auth_status";
      server: string;
      status: "started" | "authenticated" | "failed";
      message: string;
    }
  | { type: "agent_end" }
  | { type: "error"; message: string; recoverable?: boolean };

export type McpAuthStatusEvent = Extract<
  SidecarEvent,
  { type: "mcp_auth_status" }
>;

type SidecarStatusSnapshot = {
  ready: boolean;
  error: string | null;
  projectOpenError?: string | null;
  hydrate: ChatMessage[] | null;
  activeProject: ActiveProject | null;
  pendingQuestion?: PendingQuestion | null;
  recents?: RecentProject[];
};

type SessionStatus =
  | { type: "starting" }
  | { type: "ready" }
  | { type: "error"; message: string };

type SidecarSessionHandlers = {
  onCreatingStarted: (
    target: "brief" | "prd" | "issues" | "plan" | "tasks",
    message: string,
  ) => void;
  onAgentEnd: () => void;
  onHydrate: () => void;
  onError: () => void;
  onMcpAuthStatus?: (event: McpAuthStatusEvent) => void;
};

function newId() {
  return Math.random().toString(36).slice(2);
}

function formatAnswerSummary(answers: QuestionAnswer[]): string {
  return answers
    .map((answer) => {
      if (answer.kind === "option") {
        return `${answer.header}: ${answer.option.label}`;
      }
      if (answer.kind === "custom") {
        return `${answer.header}: ${answer.answer}`;
      }
      return `${answer.header}: ${answer.selected.join(", ")}`;
    })
    .join("\n");
}

export function useSidecarSession({
  onCreatingStarted,
  onAgentEnd,
  onHydrate,
  onError,
  onMcpAuthStatus,
}: SidecarSessionHandlers) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [status, setStatus] = useState<SessionStatus>({ type: "starting" });
  const [projectOpenError, setProjectOpenError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(
    null,
  );
  const [pendingQuestion, setPendingQuestion] =
    useState<PendingQuestion | null>(null);
  const [submittingQuestion, setSubmittingQuestion] = useState(false);
  const [sending, setSending] = useState(false);
  const activeAssistantId = useRef<string | null>(null);
  const hydratedFromStartupRef = useRef(false);
  const messageCountRef = useRef(0);
  const sendingRef = useRef(false);
  const submittingQuestionRef = useRef(false);

  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      setStatus({
        type: "error",
        message:
          "This app must be launched with Tauri, not a plain browser tab.",
      });
      return;
    }

    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    function finalizeActive() {
      const id = activeAssistantId.current;
      if (id) {
        setMessages((prev) => markAssistantDone(prev, id));
      }
      activeAssistantId.current = null;
      sendingRef.current = false;
      setSending(false);
      submittingQuestionRef.current = false;
      setSubmittingQuestion(false);
      setPendingQuestion(null);
    }

    listen<SidecarEvent>("sidecar-event", (event) => {
      const payload = event.payload;
      switch (payload.type) {
        case "hydrate":
          onHydrate();
          activeAssistantId.current = null;
          sendingRef.current = false;
          setSending(false);
          submittingQuestionRef.current = false;
          setSubmittingQuestion(false);
          setPendingQuestion(null);
          hydratedFromStartupRef.current = true;
          setMessages(payload.messages);
          break;
        case "ready":
          setStatus({ type: "ready" });
          break;
        case "active_project":
          setActiveProject(payload.project);
          setProjectOpenError(null);
          break;
        case "recents":
          setRecents(payload.entries);
          break;
        case "text_delta": {
          sendingRef.current = true;
          setSending(true);
          setMessages((prev) => {
            const next = applyAssistantDelta(
              prev,
              activeAssistantId.current,
              payload.delta,
              newId,
            );
            activeAssistantId.current = next.activeAssistantId;
            return next.messages;
          });
          break;
        }
        case "text_done": {
          const id = activeAssistantId.current;
          if (!id) break;
          setMessages((prev) => markAssistantDone(prev, id));
          activeAssistantId.current = null;
          break;
        }
        case "ask_user_question":
          setPendingQuestion({
            toolCallId: payload.toolCallId,
            questions: payload.questions,
          });
          break;
        case "creating_started":
          onCreatingStarted(payload.target, payload.message);
          break;
        case "mcp_auth_status":
          onMcpAuthStatus?.(payload);
          break;
        case "agent_end":
          onAgentEnd();
          finalizeActive();
          break;
        case "error":
          onError();
          console.error("[sidecar error]", payload.message);
          if (payload.recoverable) {
            setProjectOpenError(payload.message);
            finalizeActive();
            break;
          }
          setStatus({ type: "error", message: payload.message });
          finalizeActive();
          break;
        default: {
          const _exhaustive: never = payload;
          console.warn("[sidecar] unhandled event", _exhaustive);
        }
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        invoke<SidecarStatusSnapshot>("get_sidecar_status")
          .then((snapshot) => {
            if (cancelled) return;
            if (
              snapshot.hydrate &&
              !hydratedFromStartupRef.current &&
              messageCountRef.current === 0
            ) {
              hydratedFromStartupRef.current = true;
              onHydrate();
              setMessages(snapshot.hydrate);
            }
            if (snapshot.error) {
              setStatus({ type: "error", message: snapshot.error });
            } else if (snapshot.ready) {
              setStatus({ type: "ready" });
            }
            if (snapshot.projectOpenError) {
              setProjectOpenError(snapshot.projectOpenError);
            }
            if (snapshot.activeProject) {
              setActiveProject(snapshot.activeProject);
            }
            if (snapshot.pendingQuestion) {
              setPendingQuestion(snapshot.pendingQuestion);
            }
            if (snapshot.recents) {
              setRecents(snapshot.recents);
            }
          })
          .catch((err) => console.error("get_sidecar_status failed", err));
      })
      .catch((err) => {
        console.error("sidecar-event listen() failed", err);
        if (!cancelled) {
          setStatus({
            type: "error",
            message: "Failed to attach to the sidecar.",
          });
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onAgentEnd, onCreatingStarted, onError, onHydrate, onMcpAuthStatus]);

  async function sendPrompt(text: string, images: PromptImage[] = []) {
    if (
      (!text && images.length === 0) ||
      sendingRef.current ||
      status.type !== "ready"
    ) {
      return;
    }

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      done: true,
      ...(images.length > 0
        ? {
            images: images.map(({ dataUrl, mimeType }) => ({
              dataUrl,
              mimeType,
            })),
          }
        : {}),
    };
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: "assistant",
      text: "",
      done: false,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    activeAssistantId.current = assistantMsg.id;
    sendingRef.current = true;
    setSending(true);

    try {
      await invoke("send_prompt", {
        text,
        ...(images.length > 0
          ? {
              images: images.map(({ data, mimeType }) => ({
                data,
                mimeType,
              })),
            }
          : {}),
      });
    } catch (err) {
      console.error("send_prompt failed", err);
      setMessages((prev) =>
        prev.filter((m) => m.id !== userMsg.id && m.id !== assistantMsg.id),
      );
      activeAssistantId.current = null;
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function submitQuestionAnswer(answers: QuestionAnswer[]) {
    if (!pendingQuestion || submittingQuestionRef.current) return;
    submittingQuestionRef.current = true;
    setSubmittingQuestion(true);
    const toolCallId = pendingQuestion.toolCallId;

    try {
      await invoke("submit_question_answer", {
        toolCallId,
        cancelled: false,
        answers,
      });
      const summary = formatAnswerSummary(answers);
      if (summary) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "user", text: summary, done: true },
        ]);
      }
      setPendingQuestion(null);
    } finally {
      submittingQuestionRef.current = false;
      setSubmittingQuestion(false);
    }
  }

  async function cancelQuestion() {
    if (!pendingQuestion || submittingQuestionRef.current) return;
    submittingQuestionRef.current = true;
    setSubmittingQuestion(true);
    const toolCallId = pendingQuestion.toolCallId;

    try {
      await invoke("submit_question_answer", {
        toolCallId,
        cancelled: true,
        answers: [],
      });
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", text: "(skipped)", done: true },
      ]);
      setPendingQuestion(null);
    } finally {
      submittingQuestionRef.current = false;
      setSubmittingQuestion(false);
    }
  }

  async function authenticateMcpServer(server: string) {
    if (!server) throw new Error("MCP server is required.");
    if (status.type !== "ready") {
      throw new Error("Sidecar is not ready.");
    }
    await invoke("authenticate_mcp_server", { server });
  }

  async function openProject(path: string) {
    if (!path || status.type !== "ready") return;
    setProjectOpenError(null);
    try {
      await invoke("open_project", { path });
    } catch (err) {
      console.error("open_project failed", err);
    }
  }

  async function openProjectDialog() {
    if (status.type !== "ready") return;
    setProjectOpenError(null);
    try {
      const path = await invoke<string | null>("open_project_dialog");
      if (path) await openProject(path);
    } catch (err) {
      console.error("open_project_dialog failed", err);
    }
  }

  return {
    messages,
    recents,
    projectOpenError,
    activeProject,
    pendingQuestion,
    submittingQuestion,
    ready: status.type === "ready",
    error: status.type === "error" ? status.message : null,
    sending,
    sendPrompt,
    submitQuestionAnswer,
    cancelQuestion,
    authenticateMcpServer,
    openProject,
    openProjectDialog,
  };
}
