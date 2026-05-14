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

const artifactClass =
  "tasks-artifact grid min-h-full gap-3.5 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--warm)_12%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_98%,transparent))] p-6 text-foreground max-[640px]:p-[18px]";

const artifactHeaderClass =
  "tasks-artifact-header max-w-[46rem] border-b border-[var(--border)] pb-4";

const artifactTitleClass =
  "m-0 text-foreground text-[1.5rem] font-semibold leading-tight tracking-[-0.01em]";

const artifactSummaryClass =
  "mt-2 mb-0 max-w-[58ch] text-sm leading-[1.55] text-muted-foreground";

const taskListClass =
  "tasks-artifact-list mt-6 mb-0 grid list-none gap-3.5 p-0";

const taskItemClass =
  "tasks-artifact-item grid max-w-[58rem] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-sm border border-border-strong bg-card p-4 max-[640px]:grid-cols-[18px_minmax(0,1fr)]";

const markerBaseClass =
  "tasks-artifact-marker h-3.5 w-3.5 rounded-full bg-muted-foreground shadow-[0_0_0_4px_color-mix(in_srgb,var(--info)_12%,transparent)]";

const markerStatusClass: Record<TaskStatus, string> = {
  todo: "",
  in_progress:
    "bg-primary shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
  done: "bg-success shadow-[0_0_0_4px_color-mix(in_srgb,var(--success)_18%,transparent)]",
  blocked:
    "bg-warm shadow-[0_0_0_4px_color-mix(in_srgb,var(--warm)_18%,transparent)]",
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
        <p className="m-0 leading-[1.4] text-foreground">{task.title}</p>
        <span className="tasks-artifact-slug mt-1 block text-[0.82rem] text-muted-foreground">
          {task.slug}
        </span>
      </div>
      <span className="tasks-artifact-status justify-self-end whitespace-nowrap rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_76%,transparent)] px-2.5 py-[5px] text-[0.82rem] font-bold text-secondary-foreground max-[640px]:col-start-2 max-[640px]:justify-self-start">
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
