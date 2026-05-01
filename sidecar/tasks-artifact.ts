import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { slugify } from "./slug";

export const TASKS_ARTIFACT_PATH = "tasks.json";
export const TASKS_SCHEMA_VERSION = 1;
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
  schemaVersion: typeof TASKS_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  data: TasksArtifactData;
};

export type CreateTasksArtifactIssue = {
  issuePath: string;
  title: string;
};

export type TasksArtifactSuccess = {
  ok: true;
  artifact: "tasks";
  path: typeof TASKS_ARTIFACT_PATH;
  schemaVersion: typeof TASKS_SCHEMA_VERSION;
  taskCount: number;
};

export type TaskStatusSuccess = {
  ok: true;
  artifact: "tasks";
  path: typeof TASKS_ARTIFACT_PATH;
  taskSlug: string;
  status: TaskStatus;
};

export type TasksArtifactFailure = {
  ok: false;
  code:
    | "validation_error"
    | "no_active_project"
    | "tasks_already_exists"
    | "tasks_not_found"
    | "invalid_existing_artifact"
    | "unknown_task_slug"
    | "write_failed";
  field?: string;
  message: string;
  taskSlugs?: string[];
};

export type CreateTasksArtifactResult =
  | TasksArtifactSuccess
  | TasksArtifactFailure;
export type UpdateTaskStatusResult = TaskStatusSuccess | TasksArtifactFailure;

type CreateTasksArtifactInput = {
  projectRoot: string;
  issues: CreateTasksArtifactIssue[];
  now?: () => Date;
};

type UpdateTaskStatusInput = {
  projectRoot: string;
  taskSlug: string;
  status: TaskStatus;
  now?: () => Date;
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

function validationError(field: string, message: string): TasksArtifactFailure {
  return {
    ok: false,
    code: "validation_error",
    field,
    message,
  };
}

export function deriveTaskSlugFromIssuePath(issuePath: string) {
  const fileName = basename(issuePath.trim());
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return slugify(stem.replace(/^\d+-/, ""));
}

function validateTasksArtifactData(
  value: unknown,
): TasksArtifactFailure | null {
  if (!isRecord(value)) {
    return validationError("data", "Tasks data is required.");
  }

  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    return validationError("data.tasks", "At least one task is required.");
  }

  const seenSlugs = new Set<string>();
  for (const [index, task] of value.tasks.entries()) {
    if (!isRecord(task)) {
      return validationError(`data.tasks.${index}`, "Task is invalid.");
    }
    if (!isNonEmptyString(task.slug)) {
      return validationError(
        `data.tasks.${index}.slug`,
        "Task slug is required.",
      );
    }
    const slug = task.slug as string;
    if (seenSlugs.has(slug.trim())) {
      return validationError(
        `data.tasks.${index}.slug`,
        `Duplicate task slug "${slug.trim()}".`,
      );
    }
    seenSlugs.add(slug.trim());
    if (!isNonEmptyString(task.issuePath)) {
      return validationError(
        `data.tasks.${index}.issuePath`,
        "Issue path is required.",
      );
    }
    if (!isNonEmptyString(task.title)) {
      return validationError(
        `data.tasks.${index}.title`,
        "Task title is required.",
      );
    }
    if (!isTaskStatus(task.status)) {
      return validationError(
        `data.tasks.${index}.status`,
        "Task status must be todo, in_progress, done, or blocked.",
      );
    }
  }

  return null;
}

function validateCreateIssues(
  issues: unknown,
): { issues: CreateTasksArtifactIssue[] } | TasksArtifactFailure {
  if (!Array.isArray(issues) || issues.length === 0) {
    return validationError("issues", "At least one issue is required.");
  }

  const nextIssues: CreateTasksArtifactIssue[] = [];
  const seenSlugs = new Set<string>();
  for (const [index, issue] of issues.entries()) {
    if (!isRecord(issue)) {
      return validationError(`issues.${index}`, "Issue is invalid.");
    }
    if (!isNonEmptyString(issue.issuePath)) {
      return validationError(
        `issues.${index}.issuePath`,
        "Issue path is required.",
      );
    }
    if (!isNonEmptyString(issue.title)) {
      return validationError(
        `issues.${index}.title`,
        "Task title is required.",
      );
    }

    const issuePath = issue.issuePath as string;
    const title = issue.title as string;
    const slug = deriveTaskSlugFromIssuePath(issuePath);
    if (seenSlugs.has(slug)) {
      return validationError(
        `issues.${index}.issuePath`,
        `Issue path creates duplicate task slug "${slug}".`,
      );
    }
    seenSlugs.add(slug);

    nextIssues.push({
      issuePath: issuePath.trim(),
      title: title.trim(),
    });
  }

  return { issues: nextIssues };
}

function normalizeEnvelope(envelope: TasksArtifactEnvelope) {
  return {
    ...envelope,
    data: {
      tasks: envelope.data.tasks.map((task) => ({
        slug: task.slug.trim(),
        issuePath: task.issuePath.trim(),
        title: task.title.trim(),
        status: task.status,
      })),
    },
  };
}

function writeEnvelope(
  projectRoot: string,
  envelope: TasksArtifactEnvelope,
): CreateTasksArtifactResult {
  try {
    writeFileSync(
      join(projectRoot, TASKS_ARTIFACT_PATH),
      `${JSON.stringify(normalizeEnvelope(envelope), null, 2)}\n`,
      "utf8",
    );
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Could not save the Tasks artifact.",
    };
  }

  return {
    ok: true,
    artifact: "tasks",
    path: TASKS_ARTIFACT_PATH,
    schemaVersion: TASKS_SCHEMA_VERSION,
    taskCount: envelope.data.tasks.length,
  };
}

export function createTasksArtifact(
  input: CreateTasksArtifactInput,
): CreateTasksArtifactResult {
  if (existsSync(join(input.projectRoot, TASKS_ARTIFACT_PATH))) {
    return {
      ok: false,
      code: "tasks_already_exists",
      field: "tasks.json",
      message:
        "The Tasks artifact already exists. Use update_task_status for routine progress.",
    };
  }

  const validation = validateCreateIssues(input.issues);
  if (!("issues" in validation)) return validation;

  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const tasks = validation.issues.map((issue: CreateTasksArtifactIssue) => ({
    slug: deriveTaskSlugFromIssuePath(issue.issuePath),
    issuePath: issue.issuePath,
    title: issue.title,
    status: "todo" as const,
  }));

  return writeEnvelope(input.projectRoot, {
    artifact: "tasks",
    schemaVersion: TASKS_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    data: { tasks },
  });
}

export function loadTasksArtifact(
  projectRoot: string,
): TasksArtifactEnvelope | null {
  const path = join(projectRoot, TASKS_ARTIFACT_PATH);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.artifact !== "tasks") return null;
  if (parsed.schemaVersion !== TASKS_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(parsed.createdAt)) return null;
  if (!isNonEmptyString(parsed.updatedAt)) return null;
  if (validateTasksArtifactData(parsed.data)) return null;

  return parsed as TasksArtifactEnvelope;
}

export function updateTaskStatus(
  input: UpdateTaskStatusInput,
): UpdateTaskStatusResult {
  if (!isNonEmptyString(input.taskSlug)) {
    return validationError("task_slug", "Task slug is required.");
  }
  if (!isTaskStatus(input.status)) {
    return validationError(
      "status",
      "Task status must be todo, in_progress, done, or blocked.",
    );
  }

  const existing = loadTasksArtifact(input.projectRoot);
  if (!existing) {
    if (existsSync(join(input.projectRoot, TASKS_ARTIFACT_PATH))) {
      return {
        ok: false,
        code: "invalid_existing_artifact",
        field: "tasks.json",
        message: "The existing Tasks artifact is invalid.",
      };
    }

    return {
      ok: false,
      code: "tasks_not_found",
      field: "tasks.json",
      message: "Create the Tasks artifact before updating task status.",
    };
  }

  const taskSlug = input.taskSlug.trim();
  const targetTask = existing.data.tasks.find((task) => task.slug === taskSlug);
  if (!targetTask) {
    return {
      ok: false,
      code: "unknown_task_slug",
      field: "task_slug",
      message: `No task with slug "${taskSlug}" exists.`,
      taskSlugs: existing.data.tasks.map((task) => task.slug),
    };
  }

  const nextEnvelope: TasksArtifactEnvelope = {
    artifact: "tasks",
    schemaVersion: TASKS_SCHEMA_VERSION,
    createdAt: existing.createdAt,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    data: {
      tasks: existing.data.tasks.map((task) =>
        task.slug === taskSlug ? { ...task, status: input.status } : task,
      ),
    },
  };

  const writeResult = writeEnvelope(input.projectRoot, nextEnvelope);
  if (!writeResult.ok) return writeResult;

  return {
    ok: true,
    artifact: "tasks",
    path: TASKS_ARTIFACT_PATH,
    taskSlug,
    status: input.status,
  };
}
