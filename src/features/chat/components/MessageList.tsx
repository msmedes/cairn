import { useAutoScroll } from "../../../hooks/useAutoScroll";
import { cx } from "../../../lib/cx";
import type { ChatMessage } from "../chat-stream";
import type { RecentProject } from "../hooks/useSidecarSession";
import { EmptyProjectPrompt } from "./internal/EmptyProjectPrompt";

type MessageListProps = {
  messages: ChatMessage[];
  recents: RecentProject[];
  projectOpenError: string | null;
  isReady: boolean;
  hasRecapInteracted: boolean;
  onProjectOpened: (path: string) => void;
  onProjectDialogOpened: () => void;
};

const messagesClass =
  "messages min-h-0 flex flex-1 flex-col gap-[18px] overflow-y-auto px-7 pb-7 pt-1 max-[640px]:px-5 max-[640px]:pb-5 max-[640px]:pt-0";

const messageRowClass = {
  user: "msg-row msg-row-user flex justify-end",
  assistant: "msg-row msg-row-assistant flex justify-start",
} as const;

const messageBaseClass =
  "msg whitespace-pre-wrap break-words [text-wrap:pretty]";

const messageRoleClass = {
  user: "msg-user max-w-[min(54rem,80%)] rounded-[6px_6px_2px_6px] bg-[linear-gradient(180deg,var(--user-soft),var(--user))] px-[18px] py-4 text-user-foreground shadow-[0_1px_1px_rgb(255_255_255/0.04)_inset,0_20px_34px_color-mix(in_srgb,var(--background)_20%,transparent)] max-[980px]:max-w-[92%]",
  assistant:
    "msg-assistant max-w-[min(52rem,88%)] rounded-[2px_6px_6px_6px] bg-[var(--assistant)] px-5 py-[18px] text-[1.02rem] leading-[1.6] shadow-sm max-[980px]:max-w-[92%]",
} as const;

const pendingMessageClass =
  "msg-pending inline-flex min-h-11 min-w-16 items-center";

const messageImageStripClass = "msg-image-strip mb-2.5 flex flex-wrap gap-2";

const messageImageClass =
  "max-h-20 max-w-[min(180px,100%)] rounded-sm bg-[color-mix(in_srgb,var(--background)_40%,transparent)] object-contain shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]";

const typingDotsClass = "typing-dots inline-flex items-center gap-[5px]";

const typingDotClass = "h-1.5 w-1.5 rounded-full bg-current opacity-[0.38]";

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

function visibleChatMessages(messages: ChatMessage[]) {
  return messages.filter((message) => {
    const hasImages = (message.images?.length ?? 0) > 0;
    return message.text.trim() !== "" || hasImages || !message.done;
  });
}

export function MessageList({
  messages,
  recents,
  projectOpenError,
  isReady,
  hasRecapInteracted,
  onProjectOpened,
  onProjectDialogOpened,
}: MessageListProps) {
  const listRef = useAutoScroll();
  const visibleMessages = visibleChatMessages(messages);

  return (
    <div
      className={messagesClass}
      ref={listRef}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
    >
      {messages.length === 0 && (
        <EmptyProjectPrompt
          recents={recents}
          projectOpenError={projectOpenError}
          isReady={isReady}
          onProjectOpened={onProjectOpened}
          onProjectDialogOpened={onProjectDialogOpened}
        />
      )}
      {visibleMessages.map((message) => {
        const isPendingAssistant =
          message.role === "assistant" &&
          message.text.trim() === "" &&
          !message.done;
        const recapClass =
          message.kind === "recap"
            ? hasRecapInteracted
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
  );
}
