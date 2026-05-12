import type {
  TaskArtifactItem,
  TaskStatus,
  TasksArtifactData,
} from "../tasksArtifact";

type TasksArtifactViewProps = {
  data: TasksArtifactData;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

const panelKickerClass =
  "panel-kicker mb-2 mt-0 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-kanagawa-text-soft";

const artifactClass =
  "tasks-artifact grid min-h-full gap-3.5 bg-[linear-gradient(135deg,rgba(255,160,102,0.12),transparent_34%),linear-gradient(180deg,rgba(31,31,40,0.98),rgba(22,22,29,0.98))] p-[30px] text-kanagawa-text max-[640px]:p-[22px]";

const artifactHeaderClass =
  "tasks-artifact-header max-w-[46rem] border-b border-[var(--line)] pb-6";

const artifactTitleClass =
  "mt-2 mb-0 text-kanagawa-text text-[clamp(2rem,1.6rem+1.1vw,3rem)] leading-[1.02]";

const artifactSummaryClass =
  "mt-3.5 mb-0 max-w-[58ch] text-[1.05rem] leading-[1.6] text-kanagawa-text-soft";

const taskListClass =
  "tasks-artifact-list mt-6 mb-0 grid list-none gap-3.5 p-0";

const taskItemClass =
  "tasks-artifact-item grid max-w-[58rem] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-card border border-[var(--line)] bg-[rgba(42,42,55,0.72)] p-4 max-[640px]:grid-cols-[18px_minmax(0,1fr)]";

const markerBaseClass =
  "tasks-artifact-marker h-3.5 w-3.5 rounded-full bg-kanagawa-text-soft shadow-[0_0_0_4px_rgba(147,138,169,0.12)]";

const markerStatusClass: Record<TaskStatus, string> = {
  todo: "",
  in_progress: "bg-kanagawa-accent shadow-[0_0_0_4px_rgba(126,156,216,0.18)]",
  done: "bg-kanagawa-green shadow-[0_0_0_4px_rgba(152,187,108,0.18)]",
  blocked: "bg-kanagawa-warm shadow-[0_0_0_4px_rgba(255,160,102,0.18)]",
};

function statusLabel(status: TaskStatus) {
  return STATUS_LABELS[status];
}

function TasksArtifactItem({ task }: { task: TaskArtifactItem }) {
  return (
    <li className={`${taskItemClass} tasks-artifact-item-${task.status}`}>
      <span
        className={`${markerBaseClass} ${markerStatusClass[task.status]}`}
        aria-hidden="true"
      />
      <div className="tasks-artifact-copy min-w-0">
        <p className="m-0 leading-[1.4] text-kanagawa-text">{task.title}</p>
        <span className="tasks-artifact-slug mt-1 block text-[0.82rem] text-kanagawa-text-soft">
          {task.slug}
        </span>
      </div>
      <span className="tasks-artifact-status justify-self-end whitespace-nowrap rounded-full border border-[var(--line)] bg-[rgba(31,31,40,0.76)] px-2.5 py-[5px] text-[0.82rem] font-bold text-kanagawa-text-muted max-[640px]:col-start-2 max-[640px]:justify-self-start">
        {statusLabel(task.status)}
      </span>
    </li>
  );
}

export function TasksArtifactView({ data }: TasksArtifactViewProps) {
  const doneCount = data.tasks.filter((task) => task.status === "done").length;

  return (
    <article className={artifactClass} aria-labelledby="tasks-artifact-title">
      <header className={artifactHeaderClass}>
        <p className={panelKickerClass}>Tasks</p>
        <h2 className={artifactTitleClass} id="tasks-artifact-title">
          Tasks
        </h2>
        <p className={artifactSummaryClass}>
          {doneCount} of {data.tasks.length} pieces done.
        </p>
      </header>

      <ol className={taskListClass}>
        {data.tasks.map((task) => (
          <TasksArtifactItem key={task.slug} task={task} />
        ))}
      </ol>
    </article>
  );
}
