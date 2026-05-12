export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "blocked",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskArtifactItem = {
  slug: string;
  issuePath: string;
  title: string;
  status: TaskStatus;
};

export type TasksArtifactData = {
  tasks: TaskArtifactItem[];
};

export type TasksArtifactEnvelope = {
  artifact: "tasks";
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  data: TasksArtifactData;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}

function isTasksArtifactData(value: unknown): value is TasksArtifactData {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) return false;

  const seenSlugs = new Set<string>();
  for (const task of value.tasks) {
    if (!isRecord(task)) return false;
    if (!isNonEmptyString(task.slug)) return false;
    const slug = task.slug as string;
    if (seenSlugs.has(slug)) return false;
    seenSlugs.add(slug);
    if (!isNonEmptyString(task.issuePath)) return false;
    if (!isNonEmptyString(task.title)) return false;
    if (!isTaskStatus(task.status)) return false;
  }

  return true;
}

export function parseTasksArtifact(raw: string): TasksArtifactEnvelope | null {
  if (!raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.artifact !== "tasks") return null;
  if (parsed.schemaVersion !== 1) return null;
  if (!isNonEmptyString(parsed.createdAt)) return null;
  if (!isNonEmptyString(parsed.updatedAt)) return null;
  if (!isTasksArtifactData(parsed.data)) return null;

  return parsed as TasksArtifactEnvelope;
}
