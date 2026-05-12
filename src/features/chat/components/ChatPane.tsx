import type { ClipboardEvent, DragEvent } from "react";
import { useState } from "react";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import { cx } from "../../../lib/cx";
import type { ChatMessage } from "../chat-stream";
import { useAutoResizingTextarea } from "../hooks/useAutoResizingTextarea";
import { useComposerAttachments } from "../hooks/useComposerAttachments";
import type { PromptImage, RecentProject } from "../hooks/useSidecarSession";
import type { ImageAttachmentRejectionReason } from "../imageAttachment";

type ChatStatus = {
  tone: "ok" | "wait" | "attention" | "err";
  tooltip: string;
};

type ChatPaneProps = {
  messages: ChatMessage[];
  recents: RecentProject[];
  projectOpenError: string | null;
  ready: boolean;
  sending: boolean;
  recapInteracted: boolean;
  status: ChatStatus;
  onProjectOpened: (path: string) => void;
  onProjectDialogOpened: () => void;
  onPromptSubmitted: (text: string, images: PromptImage[]) => void;
  onRecapInteracted: () => void;
  onStatusClicked: () => void;
};

const chatClass =
  "chat min-h-0 min-w-0 overflow-hidden rounded-shell bg-[var(--surface)] shadow-kanagawa-lg outline outline-1 outline-[var(--line)] backdrop-blur-[18px] flex flex-col max-[980px]:min-h-[62vh]";

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

export function ChatPane({
  messages,
  recents,
  projectOpenError,
  ready,
  sending,
  recapInteracted,
  status,
  onProjectOpened,
  onProjectDialogOpened,
  onPromptSubmitted,
  onRecapInteracted,
  onStatusClicked,
}: ChatPaneProps) {
  const [input, setInput] = useState("");
  const composerAttachments = useComposerAttachments();
  const listRef = useAutoScroll();
  const { composerRef, inputRef } = useAutoResizingTextarea();
  const visibleMessages = messages.filter((message) => {
    const hasImages = (message.images?.length ?? 0) > 0;
    return message.text.trim() !== "" || hasImages || !message.done;
  });
  const canSend =
    ready &&
    !sending &&
    (input.trim() !== "" || composerAttachments.images.length > 0);

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
    onPromptSubmitted(text, images);
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

  return (
    <section className={chatClass}>
      <header className={chatHeaderClass}>
        <div className={brandClass}>
          <h1 className={brandTitleClass}>Cairn</h1>
          <button
            type="button"
            className={cx(statusDotClass, statusDotToneClass[status.tone])}
            title={status.tooltip}
            aria-label={`Status: ${status.tooltip}`}
            onClick={onStatusClicked}
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
              onClick={() => onProjectDialogOpened()}
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
                        onClick={() => onProjectOpened(recent.path)}
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
        {visibleMessages.map((message) => {
          const isPendingAssistant =
            message.role === "assistant" &&
            message.text.trim() === "" &&
            !message.done;
          const recapClass =
            message.kind === "recap"
              ? recapInteracted
                ? " msg-recap msg-recap-faded"
                : " msg-recap"
              : "";
          return (
            <div key={message.id} className={messageRowClass[message.role]}>
              <div
                className={cx(
                  messageBaseClass,
                  messageRoleClass[message.role],
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
                    {(message.images?.length ?? 0) > 0 && (
                      <div className={messageImageStripClass}>
                        {chatMessageImagesWithKeys(message).map(
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
                    {message.text && <span>{message.text}</span>}
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
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={addDroppedFiles}
      >
        {(composerAttachments.images.length > 0 ||
          composerAttachments.rejections.length > 0) && (
          <div className={attachmentPanelClass}>
            {composerAttachments.images.length > 0 && (
              <ul className={attachmentListClass} aria-label="Attached images">
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
          onFocus={onRecapInteracted}
          onChange={(event) => setInput(event.currentTarget.value)}
          onPaste={addPastedImages}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
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
  );
}
