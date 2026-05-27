import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const personaPrompt = readFileSync(
  resolve(import.meta.dir, "..", "..", "..", "prompts", "persona.md"),
  "utf8",
);

test("persona prompt uses slug-based task status transitions for Implementing", () => {
  expect(personaPrompt).toContain("create_tasks_artifact");
  expect(personaPrompt).toContain("starting as `todo`");
  expect(personaPrompt).toContain(
    'Call `update_task_status(task_slug, "in_progress")`',
  );
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "done")`',
  );
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "blocked")`',
  );
  expect(personaPrompt).toContain("When every task is `done`");
  expect(personaPrompt).toContain("dispatch the next `todo`");
  expect(personaPrompt).not.toContain("tick_task(piece_index)");
  expect(personaPrompt).not.toContain("unticked");
  expect(personaPrompt).not.toContain("has ticked");
});

test("persona prompt keeps Project context hidden and explicitly tool-owned", () => {
  expect(personaPrompt).toContain("update_project_context");
  expect(personaPrompt).toContain("raw `<project>/CONTEXT.md`");
  expect(personaPrompt).toContain("<project>/.cairn/CONTEXT.md");
  expect(personaPrompt).toContain(
    "Artifact tools do not update Project context automatically",
  );
});

test("persona prompt routes visible artifact creation through tool-owned JSON data", () => {
  expect(personaPrompt).toContain("create_brief_artifact");
  expect(personaPrompt).toContain("create_plan_artifact");
  expect(personaPrompt).toContain("create_tasks_artifact");
  expect(personaPrompt).toContain("Project tab");
  expect(personaPrompt).toContain(
    "Never use raw `Write` or `Edit` against `<project>/.cairn/brief.json`, `<project>/.cairn/plan.json`, `<project>/.cairn/tasks.json`, or `<project>/.cairn/CONTEXT.md`.",
  );
  expect(personaPrompt).not.toContain("brief.html");
  expect(personaPrompt).not.toContain("plan.html");
  expect(personaPrompt).not.toContain("tasks.html");
});

test("persona prompt frames creating indicators around artifacts, not files", () => {
  expect(personaPrompt).toContain("When you make something the user can see");
  expect(personaPrompt).toContain(
    "Reads, lookups, and other invisible work don't need bracketing",
  );
  expect(personaPrompt).not.toContain("generated HTML");
  expect(personaPrompt).not.toContain("target file");
});

test("persona prompt constrains live preview declaration", () => {
  expect(personaPrompt).toContain("set_live_preview");
  expect(personaPrompt).toContain("after there is evidence the URL responds");
  expect(personaPrompt).toContain("There is no clear tool");
  expect(personaPrompt).toContain("clears on project switch and app restart");
});

test("persona prompt lets redirect fixes use direct edits or sub-agent dispatch", () => {
  expect(personaPrompt).toContain(
    "either edit the file directly or dispatch `spawn_subagent(implement-issue)`",
  );
  expect(personaPrompt).toContain("When in doubt, dispatch");
});

test("persona prompt asks Cairn to surface underspecified major scope before the brief", () => {
  expect(personaPrompt).toContain(
    "gut-check whether the agreed scope actually fits a single slice",
  );
  expect(personaPrompt).toContain("offer a thinner version");
  expect(personaPrompt).toContain("naming the cost, not blocking it");
});
