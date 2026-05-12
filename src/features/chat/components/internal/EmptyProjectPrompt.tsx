import type { RecentProject } from "../../hooks/useSidecarSession";

type EmptyProjectPromptProps = {
  recents: RecentProject[];
  projectOpenError: string | null;
  isReady: boolean;
  onProjectOpened: (path: string) => void;
  onProjectDialogOpened: () => void;
};

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

export function EmptyProjectPrompt({
  recents,
  projectOpenError,
  isReady,
  onProjectOpened,
  onProjectDialogOpened,
}: EmptyProjectPromptProps) {
  return (
    <div className={emptyClass}>
      <button
        type="button"
        className={openFolderButtonClass}
        onClick={onProjectDialogOpened}
        disabled={!isReady}
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
                  disabled={!isReady}
                >
                  <span className={recentNameClass}>{recent.displayName}</span>
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
  );
}
