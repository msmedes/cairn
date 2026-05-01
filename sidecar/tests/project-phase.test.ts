import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  write(path, "brief.html", "<h1>Brief</h1>");
  write(path, "prds/01-slice.md");
  write(path, "issues/01-task.md");
  return path;
}

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
