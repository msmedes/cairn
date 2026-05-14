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
  "bug-report-backdrop fixed inset-0 z-30 grid place-items-start justify-items-center bg-[color-mix(in_srgb,var(--background)_54%,transparent)] px-5 pt-[clamp(24px,8vh,72px)] pb-5 backdrop-blur-[10px] animate-[bug-report-backdrop-in_180ms_ease_both]";

const dialogClass =
  "bug-report-dialog grid w-[min(440px,100%)] gap-3.5 rounded-[calc(var(--radius-sm)+8px)] bg-[color-mix(in_srgb,var(--card)_96%,transparent)] p-4 shadow-lg outline outline-1 outline-[var(--border)] animate-[bug-report-dialog-in_240ms_cubic-bezier(0.2,0,0,1)_both]";

const headerClass = "bug-report-header flex items-start justify-between gap-4";

const kickerClass =
  "bug-report-kicker mb-1.5 mt-0 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-primary";

const titleClass =
  "m-0 text-balance font-serif text-[1.45rem] font-semibold leading-[1.08] text-foreground";

const closeClass =
  "bug-report-close grid min-h-10 w-10 min-w-10 cursor-pointer place-items-center rounded-sm border-0 bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] p-0 font-[inherit] text-[1.15rem] text-muted-foreground transition-[background-color,color,transform,box-shadow] duration-[180ms,180ms,120ms,180ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1),ease] hover:not-disabled:bg-[color-mix(in_srgb,var(--muted)_96%,transparent)] hover:not-disabled:text-foreground focus-visible:not-disabled:bg-[color-mix(in_srgb,var(--muted)_96%,transparent)] focus-visible:not-disabled:text-foreground focus-visible:not-disabled:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)] focus-visible:not-disabled:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55";

const fieldClass = "bug-report-field grid gap-1.5";

const labelClass = "text-[0.86rem] font-semibold text-secondary-foreground";

const fieldControlClass =
  "w-full min-w-0 rounded-md border-0 bg-input font-[inherit] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] outline-none transition-[background-color,box-shadow] duration-180 ease-in focus:bg-[var(--muted)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_46%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-55";

const inputClass = `${fieldControlClass} min-h-10 px-3 py-0`;

const textareaClass = `${fieldControlClass} min-h-[122px] resize-y px-3 py-[11px]`;

const feedbackBaseClass =
  "m-0 rounded-md px-3 py-2.5 text-[0.88rem] leading-[1.4]";

const actionsClass = "bug-report-actions flex justify-end gap-2.5";

const actionButtonClass =
  "min-h-10 cursor-pointer rounded-md border-0 bg-secondary px-3.5 py-0 font-[inherit] font-semibold text-secondary-foreground transition-[background-color,color,transform,box-shadow,opacity] duration-[180ms,180ms,120ms,180ms,180ms] ease-[ease,ease,cubic-bezier(0.2,0,0,1),ease,ease] hover:not-disabled:bg-secondary/80 hover:not-disabled:text-foreground hover:not-disabled:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)] focus-visible:not-disabled:bg-secondary/80 focus-visible:not-disabled:text-foreground focus-visible:not-disabled:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)] focus-visible:not-disabled:outline-none active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

const submitButtonClass =
  "bg-[linear-gradient(180deg,var(--primary),color-mix(in_oklab,var(--primary),black_18%))] text-background shadow-[0_1px_1px_rgb(255_255_255/0.12)_inset,0_14px_26px_color-mix(in_srgb,color-mix(in_oklab,var(--primary),black_18%)_18%,transparent)] hover:not-disabled:text-background focus-visible:not-disabled:text-background";

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
            className={`${feedbackBaseClass} bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-[var(--destructive)]`}
          >
            {submitState.message}
          </p>
        )}
        {isPending && (
          <p
            className={`${feedbackBaseClass} bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-secondary-foreground`}
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
