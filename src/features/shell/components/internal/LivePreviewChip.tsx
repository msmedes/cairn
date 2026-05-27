import type { LivePreview } from "../../hooks/useLivePreview";

type LivePreviewChipProps = {
  livePreview: LivePreview | null;
  onClick: (url: string) => void;
};

const chipClass =
  "live-preview-chip ml-auto inline-flex min-h-10 max-w-[min(18rem,42vw)] shrink items-center gap-2 rounded-full bg-transparent px-3.5 py-0 text-sm font-medium text-foreground outline outline-1 outline-[var(--border)] transition-[background-color,box-shadow,color,transform] duration-[180ms,180ms,180ms,120ms] ease-[ease,ease,ease,cubic-bezier(0.2,0,0,1)] animate-[panel-creating-text-in_320ms_cubic-bezier(0.2,0,0,1)_both] hover:bg-[color-mix(in_srgb,var(--muted)_56%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--muted)_56%,transparent)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_20%,transparent)] focus-visible:outline-none active:scale-[0.96]";

const labelClass =
  "min-w-0 truncate animate-[panel-creating-text-in_180ms_cubic-bezier(0.2,0,0,1)_both]";

const iconClass = "h-3 w-3 shrink-0 text-muted-foreground";

export function LivePreviewChip({
  livePreview,
  onClick,
}: LivePreviewChipProps) {
  if (!livePreview) return null;

  return (
    <button
      type="button"
      className={chipClass}
      title={livePreview.url}
      onClick={() => onClick(livePreview.url)}
    >
      <span
        key={`${livePreview.url}:${livePreview.label}`}
        className={labelClass}
      >
        {livePreview.label}
      </span>
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
    </button>
  );
}
