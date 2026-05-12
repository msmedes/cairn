import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { ChatMessage } from "../../chat/chat-stream";
import type {
  JsonValue,
  SidecarDevLogEntry,
} from "../../dev-mode/useSidecarDevLog";
import { bugReportUrl } from "../bugReportUrl";

type BugReportProject = {
  path: string;
  displayName: string;
};

type BugReportDialogProps = {
  messages: ChatMessage[];
  devEvents: SidecarDevLogEntry[];
  activeProject: BugReportProject | null;
  appVersion: string;
  onClosed: () => void;
};

type SubmitState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

const backdropClass =
  "bug-report-backdrop fixed inset-0 z-30 grid place-items-start justify-items-center bg-[rgba(12,12,17,0.54)] px-5 pt-[clamp(24px,8vh,72px)] pb-5 backdrop-blur-[10px] animate-[bug-report-backdrop-in_180ms_ease_both]";

const dialogClass =
  "bug-report-dialog grid w-[min(440px,100%)] gap-3.5 rounded-[calc(var(--radius-card)+8px)] bg-[rgba(26,27,37,0.96)] p-4 shadow-kanagawa-lg outline outline-1 outline-[var(--line)] animate-[bug-report-dialog-in_240ms_cubic-bezier(0.2,0,0,1)_both]";

const headerClass = "bug-report-header flex items-start justify-between gap-4";

const kickerClass =
  "bug-report-kicker mb-1.5 mt-0 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-kanagawa-accent";

const titleClass =
  "m-0 text-balance font-serif text-[1.45rem] font-semibold leading-[1.08] text-kanagawa-text";

const closeClass =
  "bug-report-close grid min-h-10 w-10 min-w-10 cursor-pointer place-items-center rounded-card border-0 bg-[rgba(42,42,55,0.7)] p-0 font-[inherit] text-[1.15rem] text-kanagawa-text-soft transition-[background-color,color,transform,box-shadow] duration-[180ms,180ms,120ms,180ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1),ease] hover:not-disabled:bg-[rgba(50,50,66,0.96)] hover:not-disabled:text-kanagawa-text focus-visible:not-disabled:bg-[rgba(50,50,66,0.96)] focus-visible:not-disabled:text-kanagawa-text focus-visible:not-disabled:shadow-[0_0_0_4px_rgba(126,156,216,0.18)] focus-visible:not-disabled:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55";

const fieldClass = "bug-report-field grid gap-1.5";

const labelClass = "text-[0.86rem] font-semibold text-kanagawa-text-muted";

const fieldControlClass =
  "w-full min-w-0 rounded-md border-0 bg-kanagawa-surface-strong font-[inherit] text-kanagawa-text shadow-[inset_0_0_0_1px_rgba(220,215,186,0.08)] outline-none transition-[background-color,box-shadow] duration-180 ease-in focus:bg-[rgb(42,42,55)] focus:shadow-[inset_0_0_0_1px_rgba(126,156,216,0.46),0_0_0_4px_rgba(126,156,216,0.12)] disabled:cursor-not-allowed disabled:opacity-55";

const inputClass = `${fieldControlClass} min-h-10 px-3 py-0`;

const textareaClass = `${fieldControlClass} min-h-[122px] resize-y px-3 py-[11px]`;

const feedbackBaseClass =
  "m-0 rounded-md px-3 py-2.5 text-[0.88rem] leading-[1.4]";

const actionsClass = "bug-report-actions flex justify-end gap-2.5";

const actionButtonClass =
  "min-h-10 cursor-pointer rounded-md border-0 bg-[rgba(42,42,55,0.88)] px-3.5 py-0 font-[inherit] font-semibold text-kanagawa-text-muted transition-[background-color,color,transform,box-shadow,opacity] duration-[180ms,180ms,120ms,180ms,180ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1),ease,ease] hover:not-disabled:text-kanagawa-text hover:not-disabled:shadow-[0_0_0_4px_rgba(126,156,216,0.18)] focus-visible:not-disabled:text-kanagawa-text focus-visible:not-disabled:shadow-[0_0_0_4px_rgba(126,156,216,0.18)] focus-visible:not-disabled:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

const submitButtonClass =
  "bg-[linear-gradient(180deg,#7e9cd8,#658594)] text-kanagawa-bg shadow-[0_1px_1px_rgba(255,255,255,0.12)_inset,0_14px_26px_rgba(101,133,148,0.18)] hover:not-disabled:text-kanagawa-bg focus-visible:not-disabled:text-kanagawa-bg";

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scrubBugReportMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (!message.images) return message;

    return {
      ...message,
      images: message.images.map(({ mimeType }) => ({ mimeType })),
    };
  });
}

function scrubBugReportJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(scrubBugReportJsonValue);
  }

  if (!isJsonRecord(value)) {
    return value;
  }

  if (
    typeof value.mimeType === "string" &&
    ("dataUrl" in value || "data" in value || value.type === "image")
  ) {
    return value.type === "image"
      ? { type: "image", mimeType: value.mimeType }
      : { mimeType: value.mimeType };
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      scrubBugReportJsonValue(nestedValue),
    ]),
  );
}

function scrubBugReportDevEvents(devEvents: SidecarDevLogEntry[]) {
  return devEvents.map((event) => ({
    ...event,
    payload: scrubBugReportJsonValue(event.payload),
  }));
}

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Could not prepare the bug report.";
}

export function BugReportDialog({
  messages,
  devEvents,
  activeProject,
  appVersion,
  onClosed,
}: BugReportDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const isPending = submitState.status === "pending";

  async function submit() {
    if (!trimmedTitle || !trimmedDescription || isPending) return;

    const githubUrl = bugReportUrl({
      title: trimmedTitle,
      description: trimmedDescription,
      projectName: activeProject?.displayName ?? null,
      appVersion,
    });
    const now = new Date().toISOString();
    const devEventsJson = JSON.stringify(
      {
        messages: scrubBugReportMessages(messages),
        devEvents: scrubBugReportDevEvents(devEvents),
      },
      null,
      2,
    );
    const metaJson = JSON.stringify(
      {
        timestamp: now,
        appVersion,
        os: navigator.userAgent,
        activeProjectName: activeProject?.displayName ?? null,
        title: trimmedTitle,
        description: trimmedDescription,
      },
      null,
      2,
    );

    setSubmitState({ status: "pending" });
    try {
      await invoke<string>("bug_report_bundler", {
        projectPath: activeProject?.path ?? null,
        devEventsJson,
        metaJson,
        githubUrl,
      });
      onClosed();
    } catch (error) {
      setSubmitState({ status: "error", message: errorMessage(error) });
    }
  }

  return (
    <div className={backdropClass} role="presentation">
      <form
        className={dialogClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-heading"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className={headerClass}>
          <div>
            <p className={kickerClass}>Bug report</p>
            <h2 className={titleClass} id="bug-report-heading">
              Report a bug
            </h2>
          </div>
          <button
            type="button"
            className={closeClass}
            aria-label="Close bug report"
            onClick={onClosed}
            disabled={isPending}
          >
            x
          </button>
        </div>

        <label className={fieldClass} htmlFor="bug-report-title">
          <span className={labelClass}>Title</span>
          <input
            className={inputClass}
            id="bug-report-title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            disabled={isPending}
          />
        </label>

        <label className={fieldClass} htmlFor="bug-report-description">
          <span className={labelClass}>Description</span>
          <textarea
            className={textareaClass}
            id="bug-report-description"
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            disabled={isPending}
            rows={5}
          />
        </label>

        {submitState.status === "error" && (
          <p
            className={`${feedbackBaseClass} bg-[rgba(196,64,67,0.12)] text-[#e46876]`}
          >
            {submitState.message}
          </p>
        )}
        {isPending && (
          <p
            className={`${feedbackBaseClass} bg-[rgba(126,156,216,0.12)] text-kanagawa-text-muted`}
            aria-live="polite"
          >
            preparing…
          </p>
        )}

        <div className={actionsClass}>
          <button
            type="button"
            className={actionButtonClass}
            onClick={onClosed}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${actionButtonClass} ${submitButtonClass}`}
            disabled={!trimmedTitle || !trimmedDescription || isPending}
          >
            Prepare report
          </button>
        </div>
      </form>
    </div>
  );
}
