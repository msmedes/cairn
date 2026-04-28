import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuideTools } from "../guide-tools";
import type { Project } from "../project-store";
import { ProjectStore } from "../project-store";

function tempProjectsRoot() {
	return mkdtempSync(join(tmpdir(), "guide-projects-"));
}

function toolText(result: { content: Array<{ type: string; text?: string }> }) {
	return result.content.flatMap((part) => (part.text ? [part.text] : [])).join("");
}

test("set_project_name tool renames the active project and reports the updated project", async () => {
	const store = new ProjectStore(tempProjectsRoot());
	let activeProject: Project | null = store.create(
		"Temporary quiz idea",
		new Date("2026-04-28T10:00:00.000Z"),
	);
	const renamedPairs: Array<[Project, Project]> = [];
	const emittedProjects: Project[] = [];

	const [setProjectName] = createGuideTools({
		getActiveProject: () => activeProject,
		renameProject: (id, displayName) => store.rename(id, displayName),
		onRenameSuccess: (previousProject, nextProject) => {
			activeProject = nextProject;
			renamedPairs.push([previousProject, nextProject]);
		},
		onProjectUpdate: (project) => emittedProjects.push(project),
	});

	expect(setProjectName.name).toBe("set_project_name");
	expect(setProjectName.executionMode).toBe("sequential");

	const result = await setProjectName.execute(
		"tool-call-1",
		{ name: "Quiz Tool" },
		undefined,
		undefined,
		{} as never,
	);

	expect(toolText(result)).toBe("I'll call it Quiz Tool.");
	expect(result.details).toMatchObject({
		ok: true,
		projectId: "quiz-tool",
		displayName: "Quiz Tool",
	});
	expect(activeProject?.id).toBe("quiz-tool");
	expect(store.read("quiz-tool")?.displayName).toBe("Quiz Tool");
	expect(renamedPairs).toHaveLength(1);
	expect(emittedProjects).toHaveLength(1);
	expect(emittedProjects[0].id).toBe("quiz-tool");
});

test("set_project_name tool keeps voice-safe failure messages inside the tool result", async () => {
	const [setProjectName] = createGuideTools({
		getActiveProject: () => null,
		renameProject: () => {
			throw new Error("should not rename without an active project");
		},
		onRenameSuccess: () => {
			throw new Error("should not retarget without an active project");
		},
		onProjectUpdate: () => {
			throw new Error("should not emit without an active project");
		},
	});

	const result = await setProjectName.execute(
		"tool-call-1",
		{ name: "Quiz Tool" },
		undefined,
		undefined,
		{} as never,
	);

	expect(result.details).toMatchObject({ ok: false, projectId: null });
	expect(toolText(result)).not.toContain("/");
});
