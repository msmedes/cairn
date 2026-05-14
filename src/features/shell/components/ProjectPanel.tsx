import { cx } from "../../../lib/cx";
import type { BriefArtifactEnvelope } from "../../artifacts/briefArtifact";
import { BriefArtifactView } from "../../artifacts/components/BriefArtifactView";
import { PlanArtifactView } from "../../artifacts/components/PlanArtifactView";
import { TasksArtifactView } from "../../artifacts/components/TasksArtifactView";
import type { PlanArtifactEnvelope } from "../../artifacts/planArtifact";
import type { TasksArtifactEnvelope } from "../../artifacts/tasksArtifact";
import type {
  CreatingIndicator,
  CreatingTarget,
} from "../hooks/useCreatingIndicator";
import { PanelTabs } from "./internal/PanelTabs";

type ProjectPanelTab = "project" | "plan" | "tasks";

export type ProjectPanelTabItem = {
  key: ProjectPanelTab;
  label: string;
  available: boolean;
};

type ProjectPanelProps = {
  activeTab: ProjectPanelTab;
  tabs: ProjectPanelTabItem[];
  creating: CreatingIndicator | null;
  briefArtifact: BriefArtifactEnvelope | null;
  planArtifact: PlanArtifactEnvelope | null;
  tasksArtifact: TasksArtifactEnvelope | null;
  onTabSelected: (tab: ProjectPanelTab) => void;
};

const panelClass =
  "panel min-h-0 min-w-0 overflow-hidden rounded-lg bg-[var(--card)] shadow-lg outline outline-1 outline-[var(--border)] backdrop-blur-[18px] flex flex-col max-[980px]:min-h-[280px]";

const panelBodyClass =
  "panel-body flex min-h-0 flex-1 flex-col px-[18px] pb-[18px] pt-0 max-[640px]:px-4 max-[640px]:pb-4 max-[640px]:pt-0";

const artifactShellClass =
  "relative min-h-0 flex-1 overflow-auto rounded-none bg-transparent";

const panelCreatingOverlayClass =
  "panel-creating-overlay absolute bottom-6 left-6 right-6 max-w-lg rounded-sm bg-[color-mix(in_srgb,var(--card)_92%,transparent)] px-6 py-[22px] shadow-md outline outline-1 outline-[var(--border)] animate-[panel-creating-text-in_320ms_cubic-bezier(0.2,0,0,1)_both]";

const panelKickerClass =
  "panel-kicker mb-2 mt-0 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-muted-foreground";

const panelOverlayTitleClass =
  "m-0 max-w-[24ch] text-balance font-serif text-[clamp(1.25rem,1.06rem+0.58vw,1.58rem)] font-semibold leading-[1.12] tracking-[-0.03em]";

const panelPlaceholderClass =
  "panel-placeholder flex h-full flex-1 flex-col justify-center px-2.5 py-7 animate-[rise-in_580ms_cubic-bezier(0.2,0,0,1)_90ms_both] max-[640px]:px-5 max-[640px]:py-[22px]";

const panelPlaceholderTitleClass =
  "max-w-[16ch] text-balance font-serif text-[clamp(1.5rem,1.28rem+0.7vw,1.9rem)] font-semibold leading-[1.08] tracking-[-0.03em]";

const panelPlaceholderCreatingTitleClass =
  "animate-[panel-creating-text-in_320ms_cubic-bezier(0.2,0,0,1)_both]";

const panelEmptyClass =
  "panel-empty mt-3.5 mb-0 max-w-[34ch] text-base leading-[1.6] text-secondary-foreground [text-wrap:pretty]";

const panelGhostClass =
  "panel-ghost mt-7 grid gap-3 rounded-sm bg-[color-mix(in_srgb,var(--user)_18%,transparent)] p-[22px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]";

const panelGhostCreatingClass =
  "animate-[panel-creating-pulse_2.4s_ease-in-out_infinite]";

const ghostLineClass =
  "ghost-line h-[11px] rounded-sm bg-[linear-gradient(90deg,color-mix(in_srgb,var(--primary)_12%,transparent),color-mix(in_srgb,var(--foreground)_34%,transparent),color-mix(in_srgb,var(--primary)_12%,transparent))] bg-[length:220%_100%] animate-[shimmer_2.8s_linear_infinite]";

const ghostLineCreatingClass = "animate-[shimmer_1.6s_linear_infinite]";

const ghostLineTitleClass = "h-3.5 w-[42%] rounded-[5px]";

function normalizePanelTab(key: string): ProjectPanelTab {
  return key === "tasks" ? "tasks" : key === "plan" ? "plan" : "project";
}

function placeholderTarget(tab: ProjectPanelTab): CreatingTarget {
  return tab === "tasks" ? "tasks" : tab === "plan" ? "plan" : "brief";
}

export function ProjectPanel({
  activeTab,
  tabs,
  creating,
  briefArtifact,
  planArtifact,
  tasksArtifact,
  onTabSelected,
}: ProjectPanelProps) {
  const showBriefArtifact = activeTab === "project" && briefArtifact;
  const showPlanArtifact = activeTab === "plan" && planArtifact;
  const showTasksArtifact = activeTab === "tasks" && tasksArtifact;
  const showPlanEmptyState = activeTab === "plan" && !planArtifact;
  const placeholderCreating =
    showBriefArtifact || showPlanArtifact || showTasksArtifact
      ? null
      : creating;

  return (
    <aside className={panelClass}>
      <PanelTabs
        tabs={tabs}
        activeKey={activeTab}
        onSelect={(key) => onTabSelected(normalizePanelTab(key))}
      />
      <div className={panelBodyClass}>
        {showBriefArtifact ? (
          <div
            className={cx(
              "brief-artifact-shell",
              artifactShellClass,
              creating && "brief-artifact-shell-creating",
            )}
          >
            <BriefArtifactView data={briefArtifact.data} />
            {creating && (
              <section className={panelCreatingOverlayClass} aria-live="polite">
                <p className={panelKickerClass}>Working draft</p>
                <h2 className={panelOverlayTitleClass}>{creating.message}</h2>
              </section>
            )}
          </div>
        ) : showPlanArtifact ? (
          <div
            className={cx(
              "plan-artifact-shell",
              artifactShellClass,
              creating && "plan-artifact-shell-creating",
            )}
          >
            <PlanArtifactView data={planArtifact.data} />
            {creating && (
              <section className={panelCreatingOverlayClass} aria-live="polite">
                <p className={panelKickerClass}>Working draft</p>
                <h2 className={panelOverlayTitleClass}>{creating.message}</h2>
              </section>
            )}
          </div>
        ) : showTasksArtifact ? (
          <div
            className={cx(
              "tasks-artifact-shell",
              artifactShellClass,
              creating && "tasks-artifact-shell-creating",
            )}
          >
            <TasksArtifactView data={tasksArtifact.data} />
            {creating && (
              <section className={panelCreatingOverlayClass} aria-live="polite">
                <p className={panelKickerClass}>Working draft</p>
                <h2 className={panelOverlayTitleClass}>{creating.message}</h2>
              </section>
            )}
          </div>
        ) : (
          <section
            className={cx(
              panelPlaceholderClass,
              placeholderCreating && "panel-placeholder-creating",
            )}
          >
            <p className={panelKickerClass}>
              {placeholderCreating
                ? "Working draft"
                : showPlanEmptyState
                  ? "Plan"
                  : "Working draft"}
            </p>
            <h2
              className={cx(
                panelPlaceholderTitleClass,
                placeholderCreating && panelPlaceholderCreatingTitleClass,
              )}
            >
              {placeholderCreating
                ? placeholderCreating.message
                : showPlanEmptyState
                  ? "Once we agree on what to build first, the plan will show up here."
                  : "Your project will show up here as we talk."}
            </h2>
            {!placeholderCreating && !showPlanEmptyState && (
              <p className={panelEmptyClass}>
                As the conversation sharpens, this panel will turn your answers
                into a short readable plan.
              </p>
            )}
            <div
              className={cx(
                panelGhostClass,
                placeholderCreating && panelGhostCreatingClass,
              )}
              data-creating-target={placeholderTarget(activeTab)}
            >
              <div
                className={cx(
                  ghostLineClass,
                  ghostLineTitleClass,
                  placeholderCreating && ghostLineCreatingClass,
                )}
              />
              <div
                className={cx(
                  ghostLineClass,
                  "w-full",
                  placeholderCreating && ghostLineCreatingClass,
                )}
              />
              <div
                className={cx(
                  ghostLineClass,
                  "w-[76%]",
                  placeholderCreating && ghostLineCreatingClass,
                )}
              />
              <div
                className={cx(
                  ghostLineClass,
                  "w-full",
                  placeholderCreating && ghostLineCreatingClass,
                )}
              />
              <div
                className={cx(
                  ghostLineClass,
                  "w-[58%]",
                  placeholderCreating && ghostLineCreatingClass,
                )}
              />
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
