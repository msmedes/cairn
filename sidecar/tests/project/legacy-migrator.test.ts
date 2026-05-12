import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CairnDir } from "../../project/cairn-dir";
import { migrateLegacyProject } from "../../project/legacy-migrator";

function tempProjectsRoot() {
  return mkdtempSync(join(tmpdir(), "cairn-legacy-projects-"));
}

function makeLegacyProject(projectsRoot: string) {
  const projectPath = join(projectsRoot, "legacy-project");
  mkdirSync(join(projectPath, "sessions"), { recursive: true });
  mkdirSync(join(projectPath, "prds"));
  mkdirSync(join(projectPath, "issues"));
  mkdirSync(join(projectPath, "plans"));
  writeFileSync(
    join(projectPath, "project.json"),
    '{"id":"legacy-project","name":"Legacy","createdAt":"2026-05-01T00:00:00.000Z","lastOpenedAt":"2026-05-01T00:00:00.000Z"}\n',
    "utf8",
  );
  writeFileSync(join(projectPath, "sessions", "1.jsonl"), "{}\n", "utf8");
  writeFileSync(
    join(projectPath, "brief.json"),
    '{"artifact":"brief"}',
    "utf8",
  );
  writeFileSync(join(projectPath, "plan.json"), '{"artifact":"plan"}', "utf8");
  writeFileSync(
    join(projectPath, "tasks.json"),
    '{"artifact":"tasks"}',
    "utf8",
  );
  writeFileSync(join(projectPath, "CONTEXT.md"), "# Project Context\n", "utf8");
  writeFileSync(join(projectPath, "prds", "01-slice.md"), "# PRD", "utf8");
  writeFileSync(join(projectPath, "issues", "01-task.md"), "# Issue", "utf8");
  writeFileSync(join(projectPath, "plans", "plan.md"), "# Plan", "utf8");
  return projectPath;
}

test("migrateLegacyProject moves legacy project files into .cairn", () => {
  const projectsRoot = tempProjectsRoot();
  const projectPath = makeLegacyProject(projectsRoot);

  const result = migrateLegacyProject(projectPath, { projectsRoot });

  expect(result.migrated).toBe(true);
  expect(existsSync(CairnDir.metadataPath(projectPath))).toBe(true);
  expect(existsSync(CairnDir.sessionsDir(projectPath))).toBe(true);
  expect(existsSync(join(CairnDir.sessionsDir(projectPath), "1.jsonl"))).toBe(
    true,
  );
  expect(existsSync(CairnDir.briefPath(projectPath))).toBe(true);
  expect(existsSync(join(projectPath, ".cairn", "plan.json"))).toBe(true);
  expect(existsSync(CairnDir.tasksPath(projectPath))).toBe(true);
  expect(existsSync(CairnDir.projectContextPath(projectPath))).toBe(true);
  expect(existsSync(join(CairnDir.prdsDir(projectPath), "01-slice.md"))).toBe(
    true,
  );
  expect(existsSync(join(CairnDir.issuesDir(projectPath), "01-task.md"))).toBe(
    true,
  );
  expect(existsSync(join(CairnDir.plansDir(projectPath), "plan.md"))).toBe(
    true,
  );
  expect(existsSync(join(projectPath, "project.json"))).toBe(false);
  expect(existsSync(join(projectPath, "sessions"))).toBe(false);
  expect(existsSync(join(projectPath, "prds"))).toBe(false);
  expect(existsSync(join(projectPath, "issues"))).toBe(false);
  expect(existsSync(join(projectPath, "plans"))).toBe(false);
  expect(readFileSync(join(projectPath, ".cairn", ".gitignore"), "utf8")).toBe(
    "*\n",
  );
});

test("migrateLegacyProject is a no-op once already migrated", () => {
  const projectsRoot = tempProjectsRoot();
  const projectPath = makeLegacyProject(projectsRoot);
  migrateLegacyProject(projectPath, { projectsRoot });

  const result = migrateLegacyProject(projectPath, { projectsRoot });

  expect(result.migrated).toBe(false);
  expect(existsSync(CairnDir.metadataPath(projectPath))).toBe(true);
});

test("migrateLegacyProject leaves non-legacy directories alone", () => {
  const projectsRoot = tempProjectsRoot();
  const outsideRoot = mkdtempSync(join(tmpdir(), "cairn-outside-"));
  const projectPath = makeLegacyProject(outsideRoot);

  const result = migrateLegacyProject(projectPath, { projectsRoot });

  expect(result.migrated).toBe(false);
  expect(existsSync(join(projectPath, "project.json"))).toBe(true);
  expect(existsSync(join(projectPath, ".cairn"))).toBe(false);
});

test("migrateLegacyProject merges legacy directories into an existing .cairn shell", () => {
  const projectsRoot = tempProjectsRoot();
  const projectPath = makeLegacyProject(projectsRoot);
  CairnDir.ensure(projectPath);
  mkdirSync(CairnDir.sessionsDir(projectPath), { recursive: true });

  const result = migrateLegacyProject(projectPath, { projectsRoot });

  expect(result.migrated).toBe(true);
  expect(existsSync(join(CairnDir.sessionsDir(projectPath), "1.jsonl"))).toBe(
    true,
  );
  expect(existsSync(join(projectPath, "sessions"))).toBe(false);
  expect(existsSync(CairnDir.metadataPath(projectPath))).toBe(true);
});
