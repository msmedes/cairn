import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");

const legacyPaths = ["brief.html", "plan.html", "tasks.html", "tick_task"];
const supersededPrds = [
  "02-persistence-and-projects.md",
  "03-creating-indicator.md",
  "04-slicing-skills.md",
  "05-plan-tab.md",
  "06-implementing-orchestration.md",
  "07-spawn-subagent.md",
];

function readRepoFile(...parts: string[]) {
  return readFileSync(join(repoRoot, ...parts), "utf8");
}

test("retired HTML artifact helpers are not shipped", () => {
  expect(existsSync(join(repoRoot, "src", "projectSlides.ts"))).toBe(false);
  expect(existsSync(join(repoRoot, "sidecar", "tick-task.ts"))).toBe(false);
  expect(
    existsSync(join(repoRoot, "sidecar", "tests", "tick-task.test.ts")),
  ).toBe(false);
});

test("active prompts and tool descriptions do not name legacy HTML artifacts", () => {
  const activePromptSources = [
    readRepoFile("prompts", "persona.md"),
    readRepoFile("prompts", "skills", "write-brief", "SKILL.md"),
    readRepoFile("prompts", "skills", "write-plan", "SKILL.md"),
    readRepoFile("prompts", "skills", "write-tasks", "SKILL.md"),
    readRepoFile("sidecar", "cairn-tools.ts"),
    readRepoFile("sidecar", "spawn-subagent.ts"),
  ].join("\n");

  for (const legacyPath of legacyPaths) {
    expect(activePromptSources).not.toContain(legacyPath);
  }
});

test("legacy PRDs that mention generated HTML artifacts are marked superseded", () => {
  for (const prd of supersededPrds) {
    const content = readRepoFile("_meta", "prds", prd);
    expect(content).toContain("## Superseded by Slice 08");
    expect(content).toContain("ADR 0005 supersede");
    expect(content).toContain("schema-validated JSON Artifact data");
  }
});
