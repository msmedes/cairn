import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSkill(name: string) {
  return readFileSync(
    join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "prompts",
      "skills",
      name,
      "SKILL.md",
    ),
    "utf8",
  );
}

function expectNoRawWrites(content: string, canonicalPaths: string[]) {
  expect(content).toContain("Do not use raw Write or Edit");
  for (const path of canonicalPaths) {
    expect(content).toContain(path);
  }
}

test("write-brief requires Brief artifact and Project context tool calls", () => {
  const content = readSkill("write-brief");

  expect(content).toContain("Call `create_brief_artifact`");
  expect(content).toContain("Call `update_project_context`");
  expect(content).toContain("After the tool calls finish");
  expect(content).toContain('"outcome": "complete"');
  expect(content).toContain('"outcome": "failure"');
  expect(content).toContain('"outcome": "blocked"');
  expectNoRawWrites(content, ["brief.json", "CONTEXT.md"]);
});

test("write-plan requires Plan artifact tool calls instead of raw file writes", () => {
  const content = readSkill("write-plan");

  expect(content).toContain("Call `create_plan_artifact`");
  expect(content).toContain("Call `update_plan_artifact`");
  expect(content).toContain("After the tool call finishes");
  expect(content).toContain('"outcome": "complete"');
  expect(content).toContain('"outcome": "failure"');
  expectNoRawWrites(content, ["plan.json"]);
});

test("write-tasks requires Tasks artifact tool calls instead of raw file writes", () => {
  const content = readSkill("write-tasks");

  expect(content).toContain("Call `create_tasks_artifact`");
  expect(content).toContain("After the tool call finishes");
  expect(content).toContain('"outcome": "complete"');
  expect(content).toContain('"outcome": "failure"');
  expectNoRawWrites(content, ["tasks.json"]);
});
