import type { ClipboardEvent, DragEvent } from "react";
import { useState } from "react";
import { useAutoResizingTextarea } from "../hooks/useAutoResizingTextarea";
import { useComposerAttachments } from "../hooks/useComposerAttachments";
import type { PromptImage } from "../hooks/useSidecarSession";
import type { ImageAttachmentRejectionReason } from "../imageAttachment";

type ComposerProps = {
  isReady: boolean;
  isSending: boolean;
  onPromptSubmitted: (text: string, images: PromptImage[]) => void;
  onRecapInteracted: () => void;
};

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

export function Composer({
  isReady,
  isSending,
  onPromptSubmitted,
  onRecapInteracted,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const attachments = useComposerAttachments();
  const { composerRef, inputRef } = useAutoResizingTextarea();
  const canSend =
    isReady &&
    !isSending &&
    (input.trim() !== "" || attachments.images.length > 0);

  function send() {
    const text = input.trim();
    if ((!text && attachments.images.length === 0) || isSending || !isReady) {
      return;
    }
    const images = attachments.images.map(({ data, mimeType, dataUrl }) => ({
      data,
      mimeType,
      dataUrl,
    }));
    setInput("");
    attachments.clear();
    onPromptSubmitted(text, images);
  }

  function addDroppedFiles(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void attachments.addFiles(files);
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
    void attachments.addFiles(files);
  }

  return (
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
      {(attachments.images.length > 0 || attachments.rejections.length > 0) && (
        <div className={attachmentPanelClass}>
          {attachments.images.length > 0 && (
            <ul className={attachmentListClass} aria-label="Attached images">
              {attachments.images.map((image) => (
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
                    onClick={() => attachments.remove(image.id)}
                  >
                    x
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attachments.rejections.map((rejection) => (
            <p className={attachmentRejectionClass} key={rejection.id}>
              {rejection.fileName}: {attachmentRejectionLabel(rejection.reason)}
            </p>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className={composerTextareaClass}
        placeholder={isReady ? "Type a message…" : "Waking up…"}
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
        disabled={!isReady || isSending}
        aria-label="Message"
        rows={1}
      />
      <button type="submit" className={composerButtonClass} disabled={!canSend}>
        Send
      </button>
    </form>
  );
}
