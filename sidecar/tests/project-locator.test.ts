import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectRoot } from "../project-locator";

function tempTree() {
  return mkdtempSync(join(tmpdir(), "cairn-project-locator-"));
}

function mkdir(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

function markProject(path: string) {
  mkdirSync(join(path, ".cairn"), { recursive: true });
}

test("findProjectRoot returns the nearest .cairn ancestor", () => {
  const root = tempTree();
  const cases = [
    {
      name: "direct hit at startPath",
      project: mkdir(join(root, "direct")),
      start: "direct",
    },
    {
      name: "hit at parent",
      project: mkdir(join(root, "parent")),
      start: "parent/src",
    },
    {
      name: "hit at grandparent",
      project: mkdir(join(root, "grandparent")),
      start: "grandparent/src/components",
    },
  ];

  for (const entry of cases) {
    markProject(entry.project);
    expect(findProjectRoot(mkdir(join(root, entry.start))), entry.name).toBe(
      entry.project,
    );
  }
});

test("findProjectRoot returns null when no .cairn ancestor exists", () => {
  const root = tempTree();
  const start = mkdir(join(root, "plain", "src"));

  expect(findProjectRoot(start)).toBeNull();
});

test("findProjectRoot does not walk above HOME", () => {
  const root = tempTree();
  markProject(root);
  const home = mkdir(join(root, "home"));
  const start = mkdir(join(home, "nested", "src"));

  expect(findProjectRoot(start, { homeDir: home })).toBeNull();
});

test("findProjectRoot stops at the filesystem root", () => {
  const root = tempTree();
  const start = mkdir(join(root, "nested", "src"));

  expect(findProjectRoot(start, { homeDir: "/" })).toBeNull();
});
