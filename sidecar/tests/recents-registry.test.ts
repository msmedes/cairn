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
import { CairnDir } from "../cairn-dir";
import { RecentsRegistry } from "../recents-registry";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "cairn-recents-home-"));
}

function tempProject(name: string) {
  return mkdtempSync(join(tmpdir(), `cairn-${name}-`));
}

test("add upserts by absolute path and list orders by lastOpenedAt desc", () => {
  const home = tempHome();
  const registry = new RecentsRegistry({ homeDir: home });
  const older = tempProject("older");
  const newer = tempProject("newer");

  registry.add(older, "Old name", new Date("2026-05-01T10:00:00.000Z"));
  registry.add(newer, "New name", new Date("2026-05-01T11:00:00.000Z"));
  registry.add(older, "Old renamed", new Date("2026-05-01T12:00:00.000Z"));

  expect(registry.list()).toEqual([
    {
      path: older,
      displayName: "Old renamed",
      lastOpenedAt: "2026-05-01T12:00:00.000Z",
    },
    {
      path: newer,
      displayName: "New name",
      lastOpenedAt: "2026-05-01T11:00:00.000Z",
    },
  ]);
  expect(registry.findMostRecent()?.path).toBe(older);
});

test("remove prunes a stale recent", () => {
  const registry = new RecentsRegistry({ homeDir: tempHome() });
  const projectPath = tempProject("stale");

  registry.add(projectPath, "Stale", new Date("2026-05-01T10:00:00.000Z"));
  registry.remove(projectPath);

  expect(registry.list()).toEqual([]);
});

test("bootstrap scans legacy and migrated projects once when recents are absent", () => {
  const home = tempHome();
  const projectsRoot = join(home, ".cairn", "projects");
  const legacyPath = join(projectsRoot, "legacy-project");
  const migratedPath = join(projectsRoot, "migrated-project");
  mkdirSync(legacyPath, { recursive: true });
  mkdirSync(migratedPath, { recursive: true });
  writeFileSync(
    join(legacyPath, "project.json"),
    JSON.stringify({
      id: "legacy-project",
      name: "Legacy Project",
      createdAt: "2026-05-01T09:00:00.000Z",
      lastOpenedAt: "2026-05-01T09:30:00.000Z",
    }),
    "utf8",
  );
  CairnDir.ensure(migratedPath);
  writeFileSync(
    CairnDir.metadataPath(migratedPath),
    JSON.stringify({
      id: "migrated-project",
      name: "Migrated Project",
      displayName: "Migrated Display",
      createdAt: "2026-05-01T08:00:00.000Z",
      lastOpenedAt: "2026-05-01T10:30:00.000Z",
    }),
    "utf8",
  );

  const registry = new RecentsRegistry({ homeDir: home });
  registry.bootstrapFromLegacyProjects();
  registry.add(legacyPath, "User Chosen", new Date("2026-05-01T12:00:00.000Z"));
  registry.bootstrapFromLegacyProjects();

  expect(registry.list()).toEqual([
    {
      path: legacyPath,
      displayName: "User Chosen",
      lastOpenedAt: "2026-05-01T12:00:00.000Z",
    },
    {
      path: migratedPath,
      displayName: "Migrated Display",
      lastOpenedAt: "2026-05-01T10:30:00.000Z",
    },
  ]);
  expect(
    JSON.parse(readFileSync(join(home, ".cairn", "recents.json"), "utf8")),
  ).toHaveLength(2);
});

test("bootstrap creates an empty registry when no legacy projects exist", () => {
  const home = tempHome();
  const registry = new RecentsRegistry({ homeDir: home });

  registry.bootstrapFromLegacyProjects();

  expect(registry.list()).toEqual([]);
  expect(existsSync(join(home, ".cairn", "recents.json"))).toBe(true);
});
