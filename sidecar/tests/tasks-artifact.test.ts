import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTasksArtifact,
  loadTasksArtifact,
  type TaskStatus,
  updateTaskStatus,
} from "../tasks-artifact";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "guide-tasks-artifact-"));
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
  });
  expect(existsSync(join(projectRoot, "tasks.html"))).toBe(false);

  const parsed = JSON.parse(
    readFileSync(join(projectRoot, "tasks.json"), "utf8"),
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

test("createTasksArtifact validates issue input and duplicate derived slugs", () => {
  const missingIssuePath = createTasksArtifact({
    projectRoot: tempProject(),
    issues: [{ issuePath: " ", title: "Create the first quiz draft" }],
  });

  expect(missingIssuePath).toEqual({
    ok: false,
    code: "validation_error",
    field: "issues.0.issuePath",
    message: "Issue path is required.",
  });

  const duplicateSlug = createTasksArtifact({
    projectRoot: tempProject(),
    issues: [
      { issuePath: "issues/01-build-it.md", title: "Build it" },
      { issuePath: "issues/02-build-it.md", title: "Build it again" },
    ],
  });

  expect(duplicateSlug).toEqual({
    ok: false,
    code: "validation_error",
    field: "issues.1.issuePath",
    message: 'Issue path creates duplicate task slug "build-it".',
  });
});

test("loadTasksArtifact rejects invalid task statuses", () => {
  const projectRoot = tempProject();
  writeFileSync(
    join(projectRoot, "tasks.json"),
    JSON.stringify({
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
            status: "complete",
          },
        ],
      },
    }),
    "utf8",
  );

  expect(loadTasksArtifact(projectRoot)).toBeNull();
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

test("updateTaskStatus returns structured slug failures without rewriting task state", () => {
  const projectRoot = tempProject();
  createTasksArtifact({
    projectRoot,
    issues,
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });
  const before = readFileSync(join(projectRoot, "tasks.json"), "utf8");

  expect(
    updateTaskStatus({
      projectRoot,
      taskSlug: " ",
      status: "done",
    }),
  ).toEqual({
    ok: false,
    code: "validation_error",
    field: "task_slug",
    message: "Task slug is required.",
  });
  expect(readFileSync(join(projectRoot, "tasks.json"), "utf8")).toBe(before);

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
  expect(readFileSync(join(projectRoot, "tasks.json"), "utf8")).toBe(before);
});
