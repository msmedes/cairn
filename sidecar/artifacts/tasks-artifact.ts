import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { z } from "zod";
import { CairnDir } from "../project/cairn-dir";
import { slugify } from "../utils/slug";

export const TASKS_ARTIFACT_PATH = "tasks.json";
export const TASKS_SCHEMA_VERSION = 1;
export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "blocked",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const nonEmptyString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const taskStatusSchema = z.enum(TASK_STATUSES, {
  error: "Task status must be todo, in_progress, done, or blocked.",
});

export const TaskArtifactItemSchema = z.object(
  {
    slug: nonEmptyString("Task slug is required."),
    issuePath: nonEmptyString("Issue path is required."),
    title: nonEmptyString("Task title is required."),
    status: taskStatusSchema,
  },
  { error: "Task is invalid." },
);

export const TasksArtifactDataSchema = z
  .object(
    {
      tasks: z
        .array(TaskArtifactItemSchema, {
          error: "At least one task is required.",
        })
        .min(1, { error: "At least one task is required." }),
    },
    { error: "Tasks data is required." },
  )
  .superRefine((value, context) => {
    const seenSlugs = new Set<string>();
    value.tasks.forEach((task, index) => {
      if (seenSlugs.has(task.slug)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "slug"],
          message: `Duplicate task slug "${task.slug}".`,
        });
      }
      seenSlugs.add(task.slug);
    });
  });

export const CreateTasksArtifactIssueSchema = z.object(
  {
    issuePath: nonEmptyString("Issue path is required."),
    title: nonEmptyString("Task title is required."),
  },
  { error: "Issue is invalid." },
);

const createTasksArtifactIssuesSchema = z
  .array(CreateTasksArtifactIssueSchema, {
    error: "At least one issue is required.",
  })
  .min(1, { error: "At least one issue is required." })
  .superRefine((issues, context) => {
    const seenSlugs = new Set<string>();
    issues.forEach((issue, index) => {
      const slug = deriveTaskSlugFromIssuePath(issue.issuePath);
      if (seenSlugs.has(slug)) {
        context.addIssue({
          code: "custom",
          path: [index, "issuePath"],
          message: `Issue path creates duplicate task slug "${slug}".`,
        });
      }
      seenSlugs.add(slug);
    });
  });

const taskStatusInputSchema = z.object({
  taskSlug: nonEmptyString("Task slug is required."),
  status: taskStatusSchema,
});

export type TaskArtifactItem = z.infer<typeof TaskArtifactItemSchema>;
export type TasksArtifactData = z.infer<typeof TasksArtifactDataSchema>;

export type TasksArtifactEnvelope = {
  artifact: "tasks";
  schemaVersion: typeof TASKS_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  data: TasksArtifactData;
};

export type CreateTasksArtifactIssue = z.infer<
  typeof CreateTasksArtifactIssueSchema
>;

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

function issuePathToField(base: string, path: PropertyKey[]) {
  if (path.length === 0) return base;
  if (!base) return path.join(".");
  return `${base}.${path.join(".")}`;
}

function validationFailureFromZod(
  error: z.ZodError,
  baseField: string,
): TasksArtifactFailure {
  const issue = error.issues[0];
  return validationError(
    issuePathToField(baseField, issue?.path ?? []),
    issue?.message ?? "Tasks data is invalid.",
  );
}

function validateTasksArtifactData(
  value: unknown,
): TasksArtifactFailure | null {
  const parsed = TasksArtifactDataSchema.safeParse(value);
  return parsed.success ? null : validationFailureFromZod(parsed.error, "data");
}

function validateCreateIssues(
  issues: unknown,
): { issues: CreateTasksArtifactIssue[] } | TasksArtifactFailure {
  const parsed = createTasksArtifactIssuesSchema.safeParse(issues);
  return parsed.success
    ? { issues: parsed.data }
    : validationFailureFromZod(parsed.error, "issues");
}

function normalizeEnvelope(envelope: TasksArtifactEnvelope) {
  const data = TasksArtifactDataSchema.parse(envelope.data);
  return {
    ...envelope,
    data,
  };
}

function writeEnvelope(
  projectRoot: string,
  envelope: TasksArtifactEnvelope,
): CreateTasksArtifactResult {
  try {
    CairnDir.ensure(projectRoot);
    writeFileSync(
      CairnDir.tasksPath(projectRoot),
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
  if (existsSync(CairnDir.tasksPath(input.projectRoot))) {
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
  const path = CairnDir.tasksPath(projectRoot);
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
  const parsedInput = taskStatusInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return validationFailureFromZod(parsedInput.error, "");
  }

  const existing = loadTasksArtifact(input.projectRoot);
  if (!existing) {
    if (existsSync(CairnDir.tasksPath(input.projectRoot))) {
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

  const taskSlug = parsedInput.data.taskSlug;
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
        task.slug === taskSlug
          ? { ...task, status: parsedInput.data.status }
          : task,
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
    status: parsedInput.data.status,
  };
}
