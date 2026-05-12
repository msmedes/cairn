import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CairnDir } from "../../project/cairn-dir";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "cairn-dir-"));
}

test("ensure creates .cairn with a self-ignore gitignore and is idempotent", () => {
  const projectPath = tempProject();

  CairnDir.ensure(projectPath);
  CairnDir.ensure(projectPath);

  expect(existsSync(join(projectPath, ".cairn"))).toBe(true);
  expect(readFileSync(join(projectPath, ".cairn", ".gitignore"), "utf8")).toBe(
    "*\n",
  );
});

test("path helpers point every Cairn-owned file under .cairn", () => {
  const projectPath = tempProject();

  expect(CairnDir.sessionsDir(projectPath)).toBe(
    join(projectPath, ".cairn", "sessions"),
  );
  expect(CairnDir.briefPath(projectPath)).toBe(
    join(projectPath, ".cairn", "brief.json"),
  );
  expect(CairnDir.prdsDir(projectPath)).toBe(
    join(projectPath, ".cairn", "prds"),
  );
  expect(CairnDir.issuesDir(projectPath)).toBe(
    join(projectPath, ".cairn", "issues"),
  );
  expect(CairnDir.plansDir(projectPath)).toBe(
    join(projectPath, ".cairn", "plans"),
  );
  expect(CairnDir.tasksPath(projectPath)).toBe(
    join(projectPath, ".cairn", "tasks.json"),
  );
  expect(CairnDir.projectContextPath(projectPath)).toBe(
    join(projectPath, ".cairn", "CONTEXT.md"),
  );
  expect(CairnDir.metadataPath(projectPath)).toBe(
    join(projectPath, ".cairn", "project.json"),
  );
});
