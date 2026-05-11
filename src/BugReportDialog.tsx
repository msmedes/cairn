import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { bugReportUrl } from "./bugReportUrl";
import type { ChatMessage } from "./chat-stream";
import type { JsonValue, SidecarDevLogEntry } from "./useSidecarDevLog";

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
    <div className="bug-report-backdrop" role="presentation">
      <form
        className="bug-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-heading"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="bug-report-header">
          <div>
            <p className="bug-report-kicker">Bug report</p>
            <h2 id="bug-report-heading">Report a bug</h2>
          </div>
          <button
            type="button"
            className="bug-report-close"
            aria-label="Close bug report"
            onClick={onClosed}
            disabled={isPending}
          >
            x
          </button>
        </div>

        <label className="bug-report-field" htmlFor="bug-report-title">
          <span>Title</span>
          <input
            id="bug-report-title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            disabled={isPending}
          />
        </label>

        <label className="bug-report-field" htmlFor="bug-report-description">
          <span>Description</span>
          <textarea
            id="bug-report-description"
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            disabled={isPending}
            rows={5}
          />
        </label>

        {submitState.status === "error" && (
          <p className="bug-report-error">{submitState.message}</p>
        )}
        {isPending && (
          <p className="bug-report-status" aria-live="polite">
            preparing…
          </p>
        )}

        <div className="bug-report-actions">
          <button type="button" onClick={onClosed} disabled={isPending}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmedTitle || !trimmedDescription || isPending}
          >
            Prepare report
          </button>
        </div>
      </form>
    </div>
  );
}
