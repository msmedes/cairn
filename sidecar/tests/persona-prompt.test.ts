import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const personaPrompt = readFileSync(
  resolve(import.meta.dir, "..", "..", "prompts", "persona.md"),
  "utf8",
);

test("persona prompt uses slug-based task status transitions for Implementing", () => {
  expect(personaPrompt).toContain("create_tasks_artifact");
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "in_progress")`',
  );
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "done")`',
  );
  expect(personaPrompt).toContain(
    'call `update_task_status(task_slug, "blocked")`',
  );
  expect(personaPrompt).not.toContain("tick_task(piece_index)");
});
