import { cx } from "../../../lib/cx";
import {
  DEFAULT_CHAT_PANE_PERCENT,
  MAX_CHAT_PANE_PERCENT,
  MIN_CHAT_PANE_PERCENT,
} from "../hooks/usePaneSplit";

type PaneDividerProps = {
  chatPanePercent: number;
  isResizing: boolean;
  onPanePercentChanged: (
    updater: number | ((current: number) => number),
  ) => void;
  onResizeStarted: (clientX: number) => void;
};

const paneDividerClass =
  "pane-divider relative w-[14px] cursor-col-resize outline-none max-[980px]:hidden";

const paneDividerGripClass =
  "pane-divider-grip absolute left-1/2 top-1/2 h-11 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-45";

const paneDividerGripActiveClass = "h-[120px] w-2 opacity-100";

export function PaneDivider({
  chatPanePercent,
  isResizing,
  onPanePercentChanged,
  onResizeStarted,
}: PaneDividerProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: The splitter is keyboard-focusable and owns a visual grip child.
    <div
      className={paneDividerClass}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and project panels"
      aria-valuemin={MIN_CHAT_PANE_PERCENT}
      aria-valuemax={MAX_CHAT_PANE_PERCENT}
      aria-valuenow={Math.round(chatPanePercent)}
      tabIndex={0}
      onDoubleClick={() => onPanePercentChanged(DEFAULT_CHAT_PANE_PERCENT)}
      onPointerDown={(event) => {
        event.preventDefault();
        onResizeStarted(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onPanePercentChanged((prev) => prev - 3);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onPanePercentChanged((prev) => prev + 3);
        } else if (event.key === "Home") {
          event.preventDefault();
          onPanePercentChanged(MIN_CHAT_PANE_PERCENT);
        } else if (event.key === "End") {
          event.preventDefault();
          onPanePercentChanged(MAX_CHAT_PANE_PERCENT);
        }
      }}
    >
      <span
        className={cx(
          paneDividerGripClass,
          isResizing && paneDividerGripActiveClass,
        )}
        aria-hidden="true"
      />
    </div>
  );
}
