import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBriefArtifact } from "../brief-artifact";
import { getProjectState } from "../project-phase";

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

test("project_state reports implementing when tasks.html has an unchecked entry", () => {
  const path = makeSlicedProject();
  write(
    path,
    "tasks.html",
    '<ul><li><input type = "checkbox">First piece</li><li><input type="checkbox" checked>Second piece</li></ul>',
  );

  expect(getProjectState(path).phase).toBe("implementing");
});

test("project_state reports implemented when all tasks.html entries are checked", () => {
  const path = makeSlicedProject();
  write(
    path,
    "tasks.html",
    '<ul><li><input type="checkbox" checked>First piece</li><li><input checked type="checkbox">Second piece</li></ul>',
  );

  expect(getProjectState(path).phase).toBe("implemented");
});

test("project_state reports progress from class-based visual tasks", () => {
  const implementingPath = makeSlicedProject();
  write(
    implementingPath,
    "tasks.html",
    '<ul><li class="task checked done">First piece</li><li class="task unchecked">Second piece</li></ul>',
  );

  const implementedPath = makeSlicedProject();
  write(
    implementedPath,
    "tasks.html",
    '<ul><li class="task checked done">First piece</li><li class="task checked done">Second piece</li></ul>',
  );

  expect(getProjectState(implementingPath).phase).toBe("implementing");
  expect(getProjectState(implementedPath).phase).toBe("implemented");
});

test("project_state falls back to sliced for empty or malformed tasks.html", () => {
  const emptyPath = makeSlicedProject();
  write(emptyPath, "tasks.html", "   ");

  const malformedPath = makeSlicedProject();
  write(malformedPath, "tasks.html", "<p>No checkboxes yet</p>");

  expect(getProjectState(emptyPath).phase).toBe("sliced");
  expect(getProjectState(malformedPath).phase).toBe("sliced");
});
