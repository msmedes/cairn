import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTasksArtifact,
  loadTasksArtifact,
  type TaskStatus,
  updateTaskStatus,
} from "../../artifacts/tasks-artifact";
import { CairnDir } from "../../project/cairn-dir";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "cairn-tasks-artifact-"));
}

const issues = [
  {
    issuePath: "issues/01-create-the-first-quiz-draft.md",
    title: "Create the first quiz draft",
  },
  {
    issuePath: "issues/02-preview-it-as-a-learner.md",
    title: "Preview it as a learner",
  },
  {
    issuePath: "issues/03-share-the-finished-quiz.md",
    title: "Share the finished quiz",
  },
];

test("createTasksArtifact persists canonical tasks.json with issue-derived slugs", () => {
  const projectRoot = tempProject();
  const result = createTasksArtifact({
    projectRoot,
    issues,
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: true,
    artifact: "tasks",
    path: "tasks.json",
    schemaVersion: 1,
    taskCount: 3,
    taskSlugs: [
      "create-the-first-quiz-draft",
      "preview-it-as-a-learner",
      "share-the-finished-quiz",
    ],
  });
  expect(existsSync(join(CairnDir.root(projectRoot), "tasks.html"))).toBe(
    false,
  );

  const parsed = JSON.parse(
    readFileSync(CairnDir.tasksPath(projectRoot), "utf8"),
  );
  expect(parsed).toMatchObject({
    artifact: "tasks",
    schemaVersion: 1,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    data: {
      tasks: [
        {
          slug: "create-the-first-quiz-draft",
          issuePath: "issues/01-create-the-first-quiz-draft.md",
          title: "Create the first quiz draft",
          status: "todo",
        },
        {
          slug: "preview-it-as-a-learner",
          issuePath: "issues/02-preview-it-as-a-learner.md",
          title: "Preview it as a learner",
          status: "todo",
        },
        {
          slug: "share-the-finished-quiz",
          issuePath: "issues/03-share-the-finished-quiz.md",
          title: "Share the finished quiz",
          status: "todo",
        },
      ],
    },
  });
  expect(
    loadTasksArtifact(projectRoot)?.data.tasks.map((task) => task.slug),
  ).toEqual([
    "create-the-first-quiz-draft",
    "preview-it-as-a-learner",
    "share-the-finished-quiz",
  ]);
});

test.each([
  "todo",
  "in_progress",
  "done",
  "blocked",
] as const)("updateTaskStatus transitions a task to %s by slug", (status: TaskStatus) => {
  const projectRoot = tempProject();
  createTasksArtifact({
    projectRoot,
    issues,
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  const result = updateTaskStatus({
    projectRoot,
    taskSlug: "preview-it-as-a-learner",
    status,
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: true,
    artifact: "tasks",
    path: "tasks.json",
    taskSlug: "preview-it-as-a-learner",
    status,
  });
  const artifact = loadTasksArtifact(projectRoot);
  expect(artifact?.updatedAt).toBe("2026-05-01T13:00:00.000Z");
  expect(
    artifact?.data.tasks.find((task) => task.slug === "preview-it-as-a-learner")
      ?.status,
  ).toBe(status);
});

test("updateTaskStatus reports unknown slugs without rewriting task state", () => {
  const projectRoot = tempProject();
  createTasksArtifact({
    projectRoot,
    issues,
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });
  const before = readFileSync(CairnDir.tasksPath(projectRoot), "utf8");

  expect(
    updateTaskStatus({
      projectRoot,
      taskSlug: "missing-task",
      status: "done",
    }),
  ).toEqual({
    ok: false,
    code: "unknown_task_slug",
    field: "task_slug",
    message: 'No task with slug "missing-task" exists.',
    taskSlugs: [
      "create-the-first-quiz-draft",
      "preview-it-as-a-learner",
      "share-the-finished-quiz",
    ],
  });
  expect(readFileSync(CairnDir.tasksPath(projectRoot), "utf8")).toBe(before);
});
