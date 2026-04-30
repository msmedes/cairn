import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import type { CreatingTarget } from "../guide-tools";
import { createGuideTools } from "../guide-tools";
import type { Project } from "../project-store";
import { ProjectStore } from "../project-store";

function tempProjectsRoot() {
  return mkdtempSync(join(tmpdir(), "guide-projects-"));
}

function toolText(result: { content: Array<{ type: string; text?: string }> }) {
  return result.content
    .flatMap((part) => (part.text ? [part.text] : []))
    .join("");
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
    onCreatingStart: () => {
      throw new Error("should not emit creating state while naming");
    },
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
  const originalId = renamedPairs[0]?.[0].id;
  expect(originalId).toBeDefined();
  expect(result.details).toMatchObject({
    ok: true,
    projectId: originalId,
    displayName: "Quiz Tool",
  });
  expect(activeProject?.id).toBe(originalId);
  expect(activeProject?.path).toBe(renamedPairs[0]?.[0].path);
  expect(store.read(originalId as string)?.displayName).toBe("Quiz Tool");
  expect(renamedPairs).toHaveLength(1);
  expect(emittedProjects).toHaveLength(1);
  expect(emittedProjects[0].id).toBe(originalId);
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
    onCreatingStart: () => {
      throw new Error("should not emit creating state while naming");
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

test.each([
  "brief",
  "prd",
  "issues",
  "plan",
  "tasks",
] as const)("set_creating tool accepts target %s and emits it once", async (target) => {
  const creatingEvents: Array<{ target: CreatingTarget; message: string }> = [];
  const setCreating = createGuideTools({
    getActiveProject: () => null,
    renameProject: () => {
      throw new Error("should not rename while setting creating state");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while setting creating state");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while setting creating state",
      );
    },
    onCreatingStart: (target, message) => {
      creatingEvents.push({ target, message });
    },
  }).find((tool) => tool.name === "set_creating");

  expect(setCreating).toBeDefined();
  if (!setCreating) {
    throw new Error("set_creating tool was not registered");
  }

  const result = await setCreating.execute(
    "tool-call-1",
    {
      target,
      message: "Putting your project plan together",
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(creatingEvents).toEqual([
    {
      target,
      message: "Putting your project plan together",
    },
  ]);
  expect(toolText(result)).toBe("Creating indicator is showing.");
});

test("set_creating tool rejects unknown targets by schema", () => {
  const setCreating = createGuideTools({
    getActiveProject: () => null,
    renameProject: () => {
      throw new Error("should not rename while setting creating state");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while setting creating state");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while setting creating state",
      );
    },
    onCreatingStart: (target, message) => {
      throw new Error(
        `should not emit creating state for ${target}: ${message}`,
      );
    },
  }).find((tool) => tool.name === "set_creating");

  expect(setCreating).toBeDefined();
  if (!setCreating) {
    throw new Error("set_creating tool was not registered");
  }

  expect(
    Value.Check(setCreating.parameters, {
      target: "wireframe",
      message: "Putting this together",
    }),
  ).toBe(false);
  expect(
    Value.Check(setCreating.parameters, {
      target: "tasks",
      message: "Putting this together",
    }),
  ).toBe(true);
});

test("start_task tool returns the structured sub-agent outcome", async () => {
  const store = new ProjectStore(tempProjectsRoot());
  const activeProject = store.create(
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const startTask = createGuideTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while starting a task");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while starting a task");
    },
    onProjectUpdate: () => {
      throw new Error("should not emit project updates while starting a task");
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while starting a task");
    },
    startTask: async ({ projectRoot, issuePath }) => {
      expect(projectRoot).toBe(activeProject.path);
      expect(issuePath).toBe("issues/06-2-start-task.md");
      return {
        outcome: "blocked",
        message: "Need a decision before continuing.",
      };
    },
  }).find((tool) => tool.name === "start_task");

  expect(startTask).toBeDefined();
  if (!startTask) {
    throw new Error("start_task tool was not registered");
  }
  expect(startTask.executionMode).toBe("sequential");
  expect(
    Value.Check(startTask.parameters, {
      issuePath: "issues/06-2-start-task.md",
    }),
  ).toBe(true);
  expect(Value.Check(startTask.parameters, { prompt: "build it" })).toBe(false);
  expect(startTask.promptGuidelines?.join("\n")).toContain(
    "one short chat line",
  );
  expect(startTask.promptGuidelines?.join("\n")).toContain(
    "tick the matching Tasks tab entry",
  );
  expect(startTask.promptGuidelines?.join("\n")).toContain("retry");
  expect(startTask.promptGuidelines?.join("\n")).toContain("blocked");

  const result = await startTask.execute(
    "tool-call-1",
    { issuePath: "issues/06-2-start-task.md" },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toEqual({
    outcome: "blocked",
    message: "Need a decision before continuing.",
  });
  expect(toolText(result)).toBe(
    '{"outcome":"blocked","message":"Need a decision before continuing."}',
  );
});
