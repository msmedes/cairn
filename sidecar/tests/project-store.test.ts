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
import { ProjectStore } from "../project-store";

function tempProjectsRoot() {
  return mkdtempSync(join(tmpdir(), "guide-projects-"));
}

test("create and read round-trip project metadata", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const project = store.create(
    "Build me a tiny quiz app.",
    new Date("2026-04-28T10:00:00.000Z"),
  );

  expect(project).toMatchObject({
    id: "2026-04-28-build-me-a-tiny-quiz-app",
    name: "Build me a tiny quiz app.",
    createdAt: "2026-04-28T10:00:00.000Z",
    lastOpenedAt: "2026-04-28T10:00:00.000Z",
    displayName: "Build me a tiny quiz app.",
  });
  expect(existsSync(join(project.path, "project.json"))).toBe(true);
  expect(existsSync(join(project.path, "sessions"))).toBe(true);
  expect(store.read(project.id)).toEqual(project);
});

test("create falls back to untitled and disambiguates collisions", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const now = new Date("2026-04-28T10:00:00.000Z");
  const first = store.create("!!!", now);
  const second = store.create("!!!", now);

  expect(first.id).toBe("2026-04-28-untitled");
  expect(first.name).toBe("Untitled");
  expect(second.id).toBe("2026-04-28-untitled-2");
  expect(second.name).toBe("Untitled");
});

test("findMostRecent orders by lastOpenedAt", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const older = store.create(
    "Older idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const newer = store.create(
    "Newer idea",
    new Date("2026-04-28T11:00:00.000Z"),
  );

  expect(store.findMostRecent()?.id).toBe(newer.id);

  store.touch(older.id, new Date("2026-04-28T12:00:00.000Z"));
  expect(store.findMostRecent()?.id).toBe(older.id);
});

test("touch updates lastOpenedAt without changing createdAt", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const project = store.create(
    "Timer idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const touched = store.touch(project.id, new Date("2026-04-28T13:00:00.000Z"));

  expect(touched.createdAt).toBe("2026-04-28T10:00:00.000Z");
  expect(touched.lastOpenedAt).toBe("2026-04-28T13:00:00.000Z");
  expect(store.read(project.id)?.lastOpenedAt).toBe("2026-04-28T13:00:00.000Z");
});

test("rename updates display name in metadata while keeping the on-disk folder stable", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const project = store.create(
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamed = store.rename(project.id, "  Training Quiz Tool  ");

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
      readFileSync(join(renamed.project.path, "project.json"), "utf8"),
    ),
  ).toMatchObject({
    id: project.id,
    name: "Training Quiz Tool",
  });
});

test("rename allows the same display name across projects without folder collisions", () => {
  const root = tempProjectsRoot();
  const store = new ProjectStore(root);
  const first = store.create(
    "First draft",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const second = store.create(
    "Second draft",
    new Date("2026-04-28T11:00:00.000Z"),
  );

  const firstRenamed = store.rename(first.id, "Quiz Tool");
  const secondRenamed = store.rename(second.id, "Quiz Tool");

  expect(firstRenamed.ok && firstRenamed.project.id).toBe(first.id);
  expect(secondRenamed.ok && secondRenamed.project.id).toBe(second.id);
  expect(first.id).not.toBe(second.id);
  expect(store.read(first.id)?.name).toBe("Quiz Tool");
  expect(store.read(second.id)?.name).toBe("Quiz Tool");
});

test("rename handles empty names without changing the project folder", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const project = store.create(
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamed = store.rename(project.id, "   ");

  expect(renamed.ok).toBe(false);
  expect(renamed.project).toEqual(project);
  expect(existsSync(project.path)).toBe(true);
  expect(store.read(project.id)?.name).toBe("Temporary quiz idea");
});

test("rename preserves non-Latin display names while keeping the original id", () => {
  const store = new ProjectStore(tempProjectsRoot());
  const project = store.create(
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamed = store.rename(project.id, "東京の予定表");

  expect(renamed.ok && renamed.project.id).toBe(project.id);
  expect(renamed.ok && renamed.project.displayName).toBe("東京の予定表");
  expect(store.read(project.id)?.name).toBe("東京の予定表");
});

test("read rejects metadata ids that mismatch the containing folder", () => {
  const root = tempProjectsRoot();
  const store = new ProjectStore(root);
  const path = join(root, "2026-04-28-safe-project");
  mkdirSync(path);
  writeFileSync(
    join(path, "project.json"),
    JSON.stringify({
      id: "../outside",
      name: "Unsafe",
      createdAt: "2026-04-28T10:00:00.000Z",
      lastOpenedAt: "2026-04-28T10:00:00.000Z",
    }),
    "utf8",
  );

  expect(store.read("2026-04-28-safe-project")).toBeNull();
  expect(store.list()).toEqual([]);
});
