import type {
  TaskArtifactItem,
  TaskStatus,
  TasksArtifactData,
} from "./tasksArtifact";

type TasksArtifactViewProps = {
  data: TasksArtifactData;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

function statusLabel(status: TaskStatus) {
  return STATUS_LABELS[status];
}

function TasksArtifactItem({ task }: { task: TaskArtifactItem }) {
  return (
    <li className={`tasks-artifact-item tasks-artifact-item-${task.status}`}>
      <span className="tasks-artifact-marker" aria-hidden="true" />
      <div className="tasks-artifact-copy">
        <p>{task.title}</p>
        <span className="tasks-artifact-slug">{task.slug}</span>
      </div>
      <span className="tasks-artifact-status">{statusLabel(task.status)}</span>
    </li>
  );
}

export function TasksArtifactView({ data }: TasksArtifactViewProps) {
  const doneCount = data.tasks.filter((task) => task.status === "done").length;

  return (
    <article className="tasks-artifact" aria-labelledby="tasks-artifact-title">
      <header className="tasks-artifact-header">
        <p className="panel-kicker">Tasks</p>
        <h2 id="tasks-artifact-title">Tasks</h2>
        <p>
          {doneCount} of {data.tasks.length} pieces done.
        </p>
      </header>

      <ol className="tasks-artifact-list">
        {data.tasks.map((task) => (
          <TasksArtifactItem key={task.slug} task={task} />
        ))}
      </ol>
    </article>
  );
}
