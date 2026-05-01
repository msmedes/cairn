import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import type { CreatingTarget } from "../guide-tools";
import { createGuideTools } from "../guide-tools";
import type { Project } from "../project-store";
import { ProjectStore } from "../project-store";
import type { SpawnSubagentResult } from "../spawn-subagent";

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

test("guide tool registry does not surface retired task dispatcher tools", () => {
  const tools = createGuideTools({
    getActiveProject: () => null,
    renameProject: () => {
      throw new Error("should not rename while listing tools");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while listing tools");
    },
    onProjectUpdate: () => {
      throw new Error("should not emit project updates while listing tools");
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while listing tools");
    },
  });

  expect(tools.map((tool) => tool.name)).not.toContain("start_task");
  expect(tools.map((tool) => tool.name)).not.toContain("verify_slice");
});

test("spawn_subagent tool has bounded skill and response schema parameters", async () => {
  const store = new ProjectStore(tempProjectsRoot());
  const activeProject = store.create(
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const spawnResult: SpawnSubagentResult = {
    outcome: "blocked",
    message: "Need a decision before continuing.",
  };
  const spawnSubagent = createGuideTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while spawning a sub-agent");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while spawning a sub-agent");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while spawning a sub-agent",
      );
    },
    onCreatingStart: () => {
      throw new Error(
        "should not emit creating state while spawning a sub-agent",
      );
    },
    getLoadedSkills: () => [],
    spawnSubagent: async ({ projectRoot, skillName, args, responseSchema }) => {
      expect(projectRoot).toBe(activeProject.path);
      expect(skillName).toBe("write-prd");
      expect(args).toEqual({ slice: "first" });
      expect(responseSchema).toBe("task_outcome");
      return spawnResult;
    },
  }).find((tool) => tool.name === "spawn_subagent");

  expect(spawnSubagent).toBeDefined();
  if (!spawnSubagent) {
    throw new Error("spawn_subagent tool was not registered");
  }
  expect(spawnSubagent.executionMode).toBe("sequential");
  expect(
    Value.Check(spawnSubagent.parameters, {
      skill_name: "write-prd",
      args: { slice: "first" },
      response_schema: "task_outcome",
    }),
  ).toBe(true);
  expect(
    Value.Check(spawnSubagent.parameters, {
      skill_name: "wrtie-prd",
      args: { slice: "first" },
      response_schema: "task_outcome",
    }),
  ).toBe(false);
  expect(
    Value.Check(spawnSubagent.parameters, {
      skill_name: "write-prd",
      args: { slice: "first" },
      response_schema: "unknown",
    }),
  ).toBe(false);
  expect(
    Value.Check(spawnSubagent.parameters, { skill_name: "write-prd" }),
  ).toBe(false);

  const result = await spawnSubagent.execute(
    "tool-call-1",
    {
      skill_name: "write-prd",
      args: { slice: "first" },
      response_schema: "task_outcome",
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toEqual(spawnResult);
  expect(toolText(result)).toBe(
    '{"outcome":"blocked","message":"Need a decision before continuing."}',
  );
});

test("tick_task tool mutates the active project's tasks.html and returns confirmation", async () => {
  const store = new ProjectStore(tempProjectsRoot());
  const activeProject = store.create(
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const tasksPath = join(activeProject.path, "tasks.html");
  writeFileSync(
    tasksPath,
    "<ol><li>First piece</li><li>Second piece</li></ol>",
    "utf8",
  );

  const tickTask = createGuideTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while ticking a task");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while ticking a task");
    },
    onProjectUpdate: () => {
      throw new Error("should not emit project updates while ticking a task");
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while ticking a task");
    },
  }).find((tool) => tool.name === "tick_task");

  expect(tickTask).toBeDefined();
  if (!tickTask) {
    throw new Error("tick_task tool was not registered");
  }
  expect(tickTask.executionMode).toBe("sequential");
  expect(Value.Check(tickTask.parameters, { piece_index: 2 })).toBe(true);
  expect(Value.Check(tickTask.parameters, { pieceIndex: 2 })).toBe(false);
  expect(tickTask.promptGuidelines?.join("\n")).toContain(
    'tick_task(N) after each complete from spawn_subagent("implement-issue"',
  );
  expect(tickTask.promptGuidelines?.join("\n")).toContain("raw edit");

  const result = await tickTask.execute(
    "tool-call-1",
    { piece_index: 2 },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toEqual({ ok: true, message: "Marked task 2 done." });
  expect(toolText(result)).toBe("Marked task 2 done.");
  expect(readFileSync(tasksPath, "utf8")).toBe(
    '<ol><li>First piece</li><li class="checked done">Second piece</li></ol>',
  );
});

test("tick_task tool returns structured failure without an active project", async () => {
  const tickTask = createGuideTools({
    getActiveProject: () => null,
    renameProject: () => {
      throw new Error("should not rename while ticking a task");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while ticking a task");
    },
    onProjectUpdate: () => {
      throw new Error("should not emit project updates while ticking a task");
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while ticking a task");
    },
  }).find((tool) => tool.name === "tick_task");

  expect(tickTask).toBeDefined();
  if (!tickTask) {
    throw new Error("tick_task tool was not registered");
  }

  const result = await tickTask.execute(
    "tool-call-1",
    { piece_index: 1 },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toEqual({
    ok: false,
    code: "no_active_project",
    message: "No active project is open.",
  });
  expect(toolText(result)).toBe(
    '{"ok":false,"code":"no_active_project","message":"No active project is open."}',
  );
});
