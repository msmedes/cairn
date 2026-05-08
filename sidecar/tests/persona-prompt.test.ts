import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const personaPrompt = readFileSync(
  resolve(import.meta.dir, "..", "..", "prompts", "persona.md"),
  "utf8",
);

test("persona prompt uses slug-based task status transitions for Implementing", () => {
  expect(personaPrompt).toContain("create_tasks_artifact");
  expect(personaPrompt).toContain("starting as `todo`");
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "in_progress")`',
  );
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "done")`',
  );
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "blocked")`',
  );
  expect(personaPrompt).toContain("When every task is `done`");
  expect(personaPrompt).toContain("dispatch the next `todo` piece");
  expect(personaPrompt).not.toContain("tick_task(piece_index)");
  expect(personaPrompt).not.toContain("unticked");
  expect(personaPrompt).not.toContain("has ticked");
});

test("persona prompt keeps Project context hidden and explicitly tool-owned", () => {
  expect(personaPrompt).toContain("update_project_context");
  expect(personaPrompt).toContain("Never show raw `<project>/CONTEXT.md`");
  expect(personaPrompt).toContain("<project>/.cairn/CONTEXT.md");
  expect(personaPrompt).toContain(
    "Artifact tools do not update Project context automatically",
  );
});

test("persona prompt routes visible artifact creation through tool-owned JSON data", () => {
  expect(personaPrompt).toContain("create_brief_artifact");
  expect(personaPrompt).toContain("create_plan_artifact");
  expect(personaPrompt).toContain("create_tasks_artifact");
  expect(personaPrompt).toContain("schema-validated artifact data");
  expect(personaPrompt).toContain(
    "Never use raw `Write` or `Edit` against `<project>/.cairn/brief.json`, `<project>/.cairn/plan.json`, `<project>/.cairn/tasks.json`, or `<project>/.cairn/CONTEXT.md`.",
  );
  expect(personaPrompt).not.toContain("brief.html");
  expect(personaPrompt).not.toContain("plan.html");
  expect(personaPrompt).not.toContain("tasks.html");
});

test("persona prompt frames creating indicators around artifacts, not files", () => {
  expect(personaPrompt).toContain(
    "The message appears in the project panel until the visible artifact or planning moment finishes",
  );
  expect(personaPrompt).toContain(
    "The rule is only for artifacts and planning moments the user will see",
  );
  expect(personaPrompt).not.toContain("generated HTML");
  expect(personaPrompt).not.toContain("target file");
});
