import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
	const older = store.create("Older idea", new Date("2026-04-28T10:00:00.000Z"));
	const newer = store.create("Newer idea", new Date("2026-04-28T11:00:00.000Z"));

	expect(store.findMostRecent()?.id).toBe(newer.id);

	store.touch(older.id, new Date("2026-04-28T12:00:00.000Z"));
	expect(store.findMostRecent()?.id).toBe(older.id);
});

test("touch updates lastOpenedAt without changing createdAt", () => {
	const store = new ProjectStore(tempProjectsRoot());
	const project = store.create("Timer idea", new Date("2026-04-28T10:00:00.000Z"));
	const touched = store.touch(project.id, new Date("2026-04-28T13:00:00.000Z"));

	expect(touched.createdAt).toBe("2026-04-28T10:00:00.000Z");
	expect(touched.lastOpenedAt).toBe("2026-04-28T13:00:00.000Z");
	expect(store.read(project.id)?.lastOpenedAt).toBe("2026-04-28T13:00:00.000Z");
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
