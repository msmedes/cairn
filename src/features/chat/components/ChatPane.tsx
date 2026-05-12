import type { ReactNode } from "react";
import { cx } from "../../../lib/cx";

export type ChatStatus = {
  tone: "ok" | "wait" | "attention" | "err";
  tooltip: string;
};

type ChatPaneProps = {
  status: ChatStatus;
  onStatusClicked: () => void;
  children: ReactNode;
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

export function ChatPane({ status, onStatusClicked, children }: ChatPaneProps) {
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
      {children}
    </section>
  );
}
