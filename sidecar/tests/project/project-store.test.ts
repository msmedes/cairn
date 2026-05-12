import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CairnDir } from "../../project/cairn-dir";
import { ProjectStore } from "../../project/project-store";

function tempProjectPath() {
  return mkdtempSync(join(tmpdir(), "cairn-project-"));
}

test("create and read round-trip project metadata by path with placeholder display name", () => {
  const store = new ProjectStore();
  const projectPath = tempProjectPath();
  const project = store.create(
    projectPath,
    "Build me a tiny quiz app.",
    new Date("2026-04-28T10:00:00.000Z"),
  );

  expect(project).toMatchObject({
    id: "2026-04-28-build-me-a-tiny-quiz-app",
    name: "Untitled",
    createdAt: "2026-04-28T10:00:00.000Z",
    lastOpenedAt: "2026-04-28T10:00:00.000Z",
    displayName: "Untitled",
    path: projectPath,
  });
  expect(existsSync(CairnDir.metadataPath(project.path))).toBe(true);
  expect(existsSync(join(project.path, "project.json"))).toBe(false);
  expect(store.read(projectPath)).toEqual(project);
});

test("create falls back to untitled without using the folder name as identity", () => {
  const store = new ProjectStore();
  const now = new Date("2026-04-28T10:00:00.000Z");
  const first = store.create(tempProjectPath(), "!!!", now);
  const second = store.create(tempProjectPath(), "!!!", now);

  expect(first.id).toBe("2026-04-28-untitled");
  expect(first.name).toBe("Untitled");
  expect(second.id).toBe("2026-04-28-untitled");
  expect(second.name).toBe("Untitled");
  expect(first.path).not.toBe(second.path);
});

test("create uses the first message for the id but not the display name", () => {
  const store = new ProjectStore();
  const project = store.create(
    tempProjectPath(),
    "Hey, I want to build a little tool for myself that tracks chores",
    new Date("2026-04-28T10:00:00.000Z"),
  );

  expect(project.id).toBe(
    "2026-04-28-hey-i-want-to-build-a-little-tool-for-myself-that-tracks-chores",
  );
  expect(project.name).toBe("Untitled");
  expect(project.displayName).toBe("Untitled");
});

test("touch updates lastOpenedAt without changing createdAt", () => {
  const store = new ProjectStore();
  const projectPath = tempProjectPath();
  const project = store.create(
    projectPath,
    "Timer idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const touched = store.touch(
    projectPath,
    new Date("2026-04-28T13:00:00.000Z"),
  );

  expect(touched.id).toBe(project.id);
  expect(touched.createdAt).toBe("2026-04-28T10:00:00.000Z");
  expect(touched.lastOpenedAt).toBe("2026-04-28T13:00:00.000Z");
  expect(store.read(projectPath)?.lastOpenedAt).toBe(
    "2026-04-28T13:00:00.000Z",
  );
});

test("rename overwrites the placeholder display name while keeping the on-disk path stable", () => {
  const store = new ProjectStore();
  const project = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamed = store.rename(project.path, "  Training Quiz Tool  ");

  expect(renamed.ok).toBe(true);
  if (!renamed.ok) throw new Error(renamed.message);
  expect(renamed.project).toMatchObject({
    id: project.id,
    path: project.path,
    name: "Training Quiz Tool",
    displayName: "Training Quiz Tool",
    createdAt: "2026-04-28T10:00:00.000Z",
  });
  expect(existsSync(project.path)).toBe(true);
  expect(
    JSON.parse(
      readFileSync(CairnDir.metadataPath(renamed.project.path), "utf8"),
    ),
  ).toMatchObject({
    id: project.id,
    name: "Training Quiz Tool",
    displayName: "Training Quiz Tool",
  });
});

test("rename allows the same display name across projects without path collisions", () => {
  const store = new ProjectStore();
  const first = store.create(
    tempProjectPath(),
    "First draft",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const second = store.create(
    tempProjectPath(),
    "Second draft",
    new Date("2026-04-28T11:00:00.000Z"),
  );

  const firstRenamed = store.rename(first.path, "Quiz Tool");
  const secondRenamed = store.rename(second.path, "Quiz Tool");

  expect(firstRenamed.ok && firstRenamed.project.path).toBe(first.path);
  expect(secondRenamed.ok && secondRenamed.project.path).toBe(second.path);
  expect(first.path).not.toBe(second.path);
  expect(store.read(first.path)?.displayName).toBe("Quiz Tool");
  expect(store.read(second.path)?.displayName).toBe("Quiz Tool");
});

test("rename handles empty names without changing the project folder", () => {
  const store = new ProjectStore();
  const project = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamed = store.rename(project.path, "   ");

  expect(renamed.ok).toBe(false);
  expect(renamed.project).toEqual(project);
  expect(existsSync(project.path)).toBe(true);
  expect(store.read(project.path)?.name).toBe("Untitled");
});

test("rename preserves non-Latin display names while keeping the original id", () => {
  const store = new ProjectStore();
  const project = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamed = store.rename(project.path, "東京の予定表");

  expect(renamed.ok && renamed.project.id).toBe(project.id);
  expect(renamed.ok && renamed.project.displayName).toBe("東京の予定表");
  expect(store.read(project.path)?.name).toBe("東京の予定表");
});

test("read rejects unsafe generated ids without treating the folder as identity", () => {
  const store = new ProjectStore();
  const path = tempProjectPath();
  CairnDir.ensure(path);
  writeFileSync(
    CairnDir.metadataPath(path),
    JSON.stringify({
      id: "../outside",
      name: "Unsafe",
      createdAt: "2026-04-28T10:00:00.000Z",
      lastOpenedAt: "2026-04-28T10:00:00.000Z",
    }),
    "utf8",
  );

  expect(store.read(path)).toBeNull();
});

test("read accepts older safe slug ids after legacy migration", () => {
  const store = new ProjectStore();
  const path = tempProjectPath();
  CairnDir.ensure(path);
  writeFileSync(
    CairnDir.metadataPath(path),
    JSON.stringify({
      id: "legacy-project",
      name: "Legacy Project",
      createdAt: "2026-04-28T10:00:00.000Z",
      lastOpenedAt: "2026-04-28T10:00:00.000Z",
    }),
    "utf8",
  );

  expect(store.read(path)).toMatchObject({
    id: "legacy-project",
    displayName: "Legacy Project",
    path,
  });
});
