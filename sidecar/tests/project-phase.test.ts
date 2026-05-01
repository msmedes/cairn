import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBriefArtifact } from "../brief-artifact";
import { getProjectState } from "../project-phase";
import { createTasksArtifact, updateTaskStatus } from "../tasks-artifact";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "guide-project-phase-"));
}

function write(path: string, relativePath: string, content = "content") {
  writeFileSync(join(path, relativePath), content, "utf8");
}

function makeSlicedProject() {
  const path = tempProject();
  mkdirSync(join(path, "prds"));
  mkdirSync(join(path, "issues"));
  createBriefArtifact({
    projectRoot: path,
    data: {
      title: "Video Quiz Helper",
      summary: "A small tool for turning training videos into simple quizzes.",
      audience: "Team leads who need lightweight training checks.",
      success:
        "A lead can paste in a video, add questions, and share the quiz.",
      sections: [
        {
          heading: "What it does first",
          body: "It helps a lead create one quiz from one training video.",
        },
      ],
    },
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });
  write(path, "prds/01-slice.md");
  write(path, "issues/01-task.md");
  return path;
}

test("project_state treats brief.json as the scoped Brief artifact", () => {
  const path = tempProject();
  createBriefArtifact({
    projectRoot: path,
    data: {
      title: "Video Quiz Helper",
      summary: "A small tool for turning training videos into simple quizzes.",
      audience: "Team leads who need lightweight training checks.",
      success:
        "A lead can paste in a video, add questions, and share the quiz.",
      sections: [
        {
          heading: "What it does first",
          body: "It helps a lead create one quiz from one training video.",
        },
      ],
    },
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  expect(getProjectState(path)).toMatchObject({
    brief: true,
    phase: "scoped",
  });
});

test("project_state ignores malformed brief.json", () => {
  const path = tempProject();
  write(path, "brief.json", '{"artifact":"brief"}');

  expect(getProjectState(path)).toMatchObject({
    brief: false,
    phase: "scoping",
  });
});

function writeTasks(path: string) {
  createTasksArtifact({
    projectRoot: path,
    issues: [
      {
        issuePath: "issues/01-create-the-first-quiz-draft.md",
        title: "Create the first quiz draft",
      },
      {
        issuePath: "issues/02-preview-it-as-a-learner.md",
        title: "Preview it as a learner",
      },
    ],
  });
}

test("project_state reports implementing from JSON task status", () => {
  const path = makeSlicedProject();
  writeTasks(path);
  updateTaskStatus({
    projectRoot: path,
    taskSlug: "preview-it-as-a-learner",
    status: "done",
  });

  expect(getProjectState(path).phase).toBe("implementing");
});

test("project_state reports implemented when every JSON task is done", () => {
  const path = makeSlicedProject();
  writeTasks(path);
  updateTaskStatus({
    projectRoot: path,
    taskSlug: "create-the-first-quiz-draft",
    status: "done",
  });
  updateTaskStatus({
    projectRoot: path,
    taskSlug: "preview-it-as-a-learner",
    status: "done",
  });

  expect(getProjectState(path).phase).toBe("implemented");
});

test.each([
  "todo",
  "in_progress",
  "blocked",
] as const)("project_state treats %s task status as implementing", (status) => {
  const path = makeSlicedProject();
  writeTasks(path);
  updateTaskStatus({
    projectRoot: path,
    taskSlug: "create-the-first-quiz-draft",
    status,
  });
  updateTaskStatus({
    projectRoot: path,
    taskSlug: "preview-it-as-a-learner",
    status: "done",
  });

  expect(getProjectState(path).phase).toBe("implementing");
});

test("project_state ignores legacy tasks.html and reads only tasks.json", () => {
  const path = makeSlicedProject();
  write(
    path,
    "tasks.html",
    '<ul><li><input type="checkbox" checked>First piece</li></ul>',
  );

  expect(getProjectState(path).phase).toBe("sliced");
});

test("project_state falls back to sliced for empty or malformed tasks.json", () => {
  const emptyPath = makeSlicedProject();
  write(emptyPath, "tasks.json", "   ");

  const malformedPath = makeSlicedProject();
  write(malformedPath, "tasks.json", '{"artifact":"tasks"}');

  expect(getProjectState(emptyPath).phase).toBe("sliced");
  expect(getProjectState(malformedPath).phase).toBe("sliced");
});
