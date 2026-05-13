import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CairnDir } from "../../project/cairn-dir";
import type { Project } from "../../project/project-store";
import { ProjectStore } from "../../project/project-store";
import type { SpawnSubagentResult } from "../../subagents/spawn-subagent";
import type { CreatingTarget } from "../../tools/cairn-tools";
import { createCairnTools } from "../../tools/cairn-tools";

function tempProjectPath() {
  return mkdtempSync(join(tmpdir(), "cairn-project-"));
}

function toolText(result: { content: Array<{ type: string; text?: string }> }) {
  return result.content
    .flatMap((part) => (part.text ? [part.text] : []))
    .join("");
}

function createActiveProjectTools(project: Project) {
  return createCairnTools({
    getActiveProject: () => project,
    renameProject: () => {
      throw new Error("should not rename while using file tools");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while using file tools");
    },
    onProjectUpdate: () => {
      throw new Error("should not emit project updates while using file tools");
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while using file tools");
    },
  });
}

test("edit tool replaces a unique substring inside the active project", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  mkdirSync(join(activeProject.path, "src", "lib"), { recursive: true });
  writeFileSync(
    join(activeProject.path, "src", "lib", "matchMeals.ts"),
    "export const matches = meals.every((meal) => meal.ready);\n",
    "utf8",
  );
  const edit = createActiveProjectTools(activeProject).find(
    (tool) => tool.name === "edit",
  );

  expect(edit).toBeDefined();
  if (!edit) {
    throw new Error("edit tool was not registered");
  }

  const result = await edit.execute(
    "tool-call-1",
    {
      path: "src/lib/matchMeals.ts",
      oldText: "meals.every",
      newText: "meals.some",
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: true,
    path: "src/lib/matchMeals.ts",
  });
  expect(
    readFileSync(
      join(activeProject.path, "src", "lib", "matchMeals.ts"),
      "utf8",
    ),
  ).toContain("meals.some");
});

test("edit tool rejects missing substrings without rewriting", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  const path = join(activeProject.path, "matchMeals.ts");
  writeFileSync(path, "const predicate = 'every';\n", "utf8");
  const edit = createActiveProjectTools(activeProject).find(
    (tool) => tool.name === "edit",
  );

  if (!edit) {
    throw new Error("edit tool was not registered");
  }

  const result = await edit.execute(
    "tool-call-1",
    {
      path: "matchMeals.ts",
      oldText: "some",
      newText: "every",
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: false,
    code: "no_match",
  });
  expect(readFileSync(path, "utf8")).toBe("const predicate = 'every';\n");
});

test("edit tool rejects ambiguous substrings without rewriting", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  const path = join(activeProject.path, "matchMeals.ts");
  writeFileSync(path, "every(() => true);\nevery(() => false);\n", "utf8");
  const edit = createActiveProjectTools(activeProject).find(
    (tool) => tool.name === "edit",
  );

  if (!edit) {
    throw new Error("edit tool was not registered");
  }

  const result = await edit.execute(
    "tool-call-1",
    {
      path: "matchMeals.ts",
      oldText: "every",
      newText: "some",
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: false,
    code: "ambiguous_match",
  });
  expect(readFileSync(path, "utf8")).toBe(
    "every(() => true);\nevery(() => false);\n",
  );
});

test("file tools reject paths that escape the active project", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  const read = createActiveProjectTools(activeProject).find(
    (tool) => tool.name === "read",
  );

  if (!read) {
    throw new Error("read tool was not registered");
  }

  const result = await read.execute(
    "tool-call-1",
    { path: "../outside.txt" },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: false,
    code: "path_escape",
  });
});

test("write tool rejects direct writes under .cairn and points at artifact tools", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  const write = createActiveProjectTools(activeProject).find(
    (tool) => tool.name === "write",
  );

  if (!write) {
    throw new Error("write tool was not registered");
  }

  const result = await write.execute(
    "tool-call-1",
    { path: ".cairn/brief.json", content: "{}" },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: false,
    code: "cairn_path",
    message: expect.stringContaining("artifact tools"),
  });
  expect(existsSync(CairnDir.briefPath(activeProject.path))).toBe(false);
});

test("read and edit tools also reject direct access under .cairn", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  const [read, edit] = createActiveProjectTools(activeProject).filter((tool) =>
    ["read", "edit"].includes(tool.name),
  );

  if (!read || !edit) {
    throw new Error("read and edit tools were not registered");
  }

  const readResult = await read.execute(
    "tool-call-1",
    { path: ".cairn/tasks.json" },
    undefined,
    undefined,
    {} as never,
  );
  const editResult = await edit.execute(
    "tool-call-2",
    {
      path: ".cairn/tasks.json",
      oldText: "todo",
      newText: "done",
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(readResult.details).toMatchObject({
    ok: false,
    code: "cairn_path",
  });
  expect(editResult.details).toMatchObject({
    ok: false,
    code: "cairn_path",
  });
});

test("file tools reject symlink escapes from the active project", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Dinner Picker",
    new Date("2026-05-12T10:00:00.000Z"),
  );
  const outsidePath = join(tempProjectPath(), "outside.txt");
  writeFileSync(outsidePath, "outside\n", "utf8");
  symlinkSync(outsidePath, join(activeProject.path, "linked-outside.txt"));
  const [read, write] = createActiveProjectTools(activeProject).filter((tool) =>
    ["read", "write"].includes(tool.name),
  );

  if (!read || !write) {
    throw new Error("read and write tools were not registered");
  }

  const readResult = await read.execute(
    "tool-call-1",
    { path: "linked-outside.txt" },
    undefined,
    undefined,
    {} as never,
  );
  const writeResult = await write.execute(
    "tool-call-2",
    { path: "linked-outside.txt", content: "mutated\n" },
    undefined,
    undefined,
    {} as never,
  );

  expect(readResult.details).toMatchObject({
    ok: false,
    code: "path_escape",
  });
  expect(writeResult.details).toMatchObject({
    ok: false,
    code: "path_escape",
  });
  expect(readFileSync(outsidePath, "utf8")).toBe("outside\n");
});

test("set_project_name tool renames the active project and reports the updated project", async () => {
  const store = new ProjectStore();
  let activeProject: Project | null = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const renamedPairs: Array<[Project, Project]> = [];
  const emittedProjects: Project[] = [];

  const setProjectName = createCairnTools({
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
  }).find((tool) => tool.name === "set_project_name");

  expect(setProjectName).toBeDefined();
  if (!setProjectName) {
    throw new Error("set_project_name tool was not registered");
  }
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
  expect(store.read(renamedPairs[0]?.[0].path ?? "")?.displayName).toBe(
    "Quiz Tool",
  );
  expect(renamedPairs).toHaveLength(1);
  expect(emittedProjects).toHaveLength(1);
  expect(emittedProjects[0].id).toBe(originalId);
});

test("set_project_name tool keeps voice-safe failure messages inside the tool result", async () => {
  const setProjectName = createCairnTools({
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
  }).find((tool) => tool.name === "set_project_name");

  expect(setProjectName).toBeDefined();
  if (!setProjectName) {
    throw new Error("set_project_name tool was not registered");
  }

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
  const setCreating = createCairnTools({
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

test("cairn tool registry does not surface retired task dispatcher tools", () => {
  const tools = createCairnTools({
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
  expect(tools.map((tool) => tool.name)).not.toContain("tick_task");
});

test("spawn_subagent tool routes bounded skill work to the active project", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const spawnResult: SpawnSubagentResult = {
    outcome: "blocked",
    message: "Need a decision before continuing.",
  };
  const spawnSubagent = createCairnTools({
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

test("create_tasks_artifact tool writes tasks.json only", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );

  const createTasks = createCairnTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while creating tasks");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while creating tasks");
    },
    onProjectUpdate: () => {
      throw new Error("should not emit project updates while creating tasks");
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while creating tasks");
    },
  }).find((tool) => tool.name === "create_tasks_artifact");

  expect(createTasks).toBeDefined();
  if (!createTasks) {
    throw new Error("create_tasks_artifact tool was not registered");
  }
  expect(createTasks.executionMode).toBe("sequential");
  expect(createTasks.promptGuidelines?.join("\n")).toContain(
    "derives task slugs from issue paths",
  );
  expect(createTasks.promptGuidelines?.join("\n")).toContain("tasks.json");

  const result = await createTasks.execute(
    "tool-call-1",
    {
      issues: [
        {
          issue_path: "issues/01-create-the-first-quiz-draft.md",
          title: "Create the first quiz draft",
        },
        {
          issue_path: "issues/02-preview-it-as-a-learner.md",
          title: "Preview it as a learner",
        },
      ],
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: true,
    artifact: "tasks",
    path: "tasks.json",
    taskCount: 2,
    taskSlugs: ["create-the-first-quiz-draft", "preview-it-as-a-learner"],
  });
  expect(toolText(result)).toBe(
    '{"ok":true,"artifact":"tasks","path":"tasks.json","schemaVersion":1,"taskCount":2,"taskSlugs":["create-the-first-quiz-draft","preview-it-as-a-learner"]}',
  );
  expect(
    readFileSync(CairnDir.tasksPath(activeProject.path), "utf8"),
  ).toContain('"slug": "create-the-first-quiz-draft"');
  expect(() =>
    readFileSync(join(CairnDir.root(activeProject.path), "tasks.html"), "utf8"),
  ).toThrow();
});

test("update_task_status tool accepts a slug returned by create_tasks_artifact on the first attempt", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const [createTasks, updateTaskStatus] = createCairnTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while updating task status");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while updating task status");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while updating task status",
      );
    },
    onCreatingStart: () => {
      throw new Error(
        "should not emit creating state while updating task status",
      );
    },
  }).filter((tool) =>
    ["create_tasks_artifact", "update_task_status"].includes(tool.name),
  );

  if (!createTasks || !updateTaskStatus) {
    throw new Error("tasks artifact tools were not registered");
  }

  const createResult = await createTasks.execute(
    "tool-call-1",
    {
      issues: [
        {
          issue_path: "issues/01-create-the-first-quiz-draft.md",
          title: "Create the first quiz draft",
        },
        {
          issue_path: "issues/02-preview-it-as-a-learner.md",
          title: "Preview it as a learner",
        },
      ],
    },
    undefined,
    undefined,
    {} as never,
  );
  expect(createResult.details).toMatchObject({
    ok: true,
    taskSlugs: ["create-the-first-quiz-draft", "preview-it-as-a-learner"],
  });
  const taskSlugs = (createResult.details as { taskSlugs: string[] }).taskSlugs;

  const result = await updateTaskStatus.execute(
    "tool-call-2",
    { task_slug: taskSlugs[1], status: "in_progress" },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toEqual({
    ok: true,
    artifact: "tasks",
    path: "tasks.json",
    taskSlug: "preview-it-as-a-learner",
    status: "in_progress",
  });
  expect(toolText(result)).toBe(
    '{"ok":true,"artifact":"tasks","path":"tasks.json","taskSlug":"preview-it-as-a-learner","status":"in_progress"}',
  );
  expect(
    readFileSync(CairnDir.tasksPath(activeProject.path), "utf8"),
  ).toContain('"status": "in_progress"');
});

test("update_task_status tool reports unknown slugs without rewriting tasks", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const [createTasks, updateTaskStatus] = createCairnTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while updating task status");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while updating task status");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while updating task status",
      );
    },
    onCreatingStart: () => {
      throw new Error(
        "should not emit creating state while updating task status",
      );
    },
  }).filter((tool) =>
    ["create_tasks_artifact", "update_task_status"].includes(tool.name),
  );

  if (!createTasks || !updateTaskStatus) {
    throw new Error("tasks artifact tools were not registered");
  }

  await createTasks.execute(
    "tool-call-1",
    {
      issues: [
        {
          issue_path: "issues/01-create-the-first-quiz-draft.md",
          title: "Create the first quiz draft",
        },
        {
          issue_path: "issues/02-preview-it-as-a-learner.md",
          title: "Preview it as a learner",
        },
      ],
    },
    undefined,
    undefined,
    {} as never,
  );

  const beforeMissing = readFileSync(
    CairnDir.tasksPath(activeProject.path),
    "utf8",
  );

  const missing = await updateTaskStatus.execute(
    "tool-call-2",
    { task_slug: "missing-task", status: "done" },
    undefined,
    undefined,
    {} as never,
  );

  expect(missing.details).toMatchObject({
    ok: false,
    code: "unknown_task_slug",
    field: "task_slug",
  });
  expect(readFileSync(CairnDir.tasksPath(activeProject.path), "utf8")).toBe(
    beforeMissing,
  );
});

test("create_brief_artifact tool writes brief.json only", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const createBrief = createCairnTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while creating a brief artifact");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while creating a brief artifact");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while creating a brief artifact",
      );
    },
    onCreatingStart: () => {
      throw new Error(
        "should not emit creating state while creating a brief artifact",
      );
    },
  }).find((tool) => tool.name === "create_brief_artifact");

  expect(createBrief).toBeDefined();
  if (!createBrief) {
    throw new Error("create_brief_artifact tool was not registered");
  }
  expect(createBrief.executionMode).toBe("sequential");

  const result = await createBrief.execute(
    "tool-call-1",
    {
      title: "Video Quiz Helper",
      summary: "A small tool for turning training videos into simple quizzes.",
      audience: "Team leads who need lightweight training checks.",
      success:
        "A lead can paste in a video, add questions, and share the quiz.",
      sections: [
        {
          heading: "What it does first",
          body: "It helps a lead create one quiz from one training video.",
        },
      ],
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: true,
    artifact: "brief",
    path: "brief.json",
    title: "Video Quiz Helper",
  });
  expect(toolText(result)).toBe(
    '{"ok":true,"artifact":"brief","path":"brief.json","schemaVersion":1,"title":"Video Quiz Helper","sectionCount":1}',
  );
  expect(
    readFileSync(CairnDir.briefPath(activeProject.path), "utf8"),
  ).toContain('"artifact": "brief"');
  expect(existsSync(CairnDir.projectContextPath(activeProject.path))).toBe(
    false,
  );
  expect(() =>
    readFileSync(join(CairnDir.root(activeProject.path), "brief.html"), "utf8"),
  ).toThrow();
});

test("create_plan_artifact tool writes plan.json only", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const createPlan = createCairnTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while creating a plan artifact");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while creating a plan artifact");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while creating a plan artifact",
      );
    },
    onCreatingStart: () => {
      throw new Error(
        "should not emit creating state while creating a plan artifact",
      );
    },
  }).find((tool) => tool.name === "create_plan_artifact");

  expect(createPlan).toBeDefined();
  if (!createPlan) {
    throw new Error("create_plan_artifact tool was not registered");
  }
  expect(createPlan.executionMode).toBe("sequential");

  const result = await createPlan.execute(
    "tool-call-1",
    {
      title: "First playable quiz",
      summary: "Start with one video and one shareable quiz.",
      from_brief:
        "The brief asks for lightweight checks, so this proves one quiz end to end.",
      outcomes: ["You'll be able to paste in one training video."],
      pieces: [
        "Create the first quiz draft",
        "Preview it as a learner",
        "Share the finished quiz",
      ],
      not_yet: ["Team analytics", "Question banks"],
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: true,
    artifact: "plan",
    path: "plan.json",
    title: "First playable quiz",
    pieceCount: 3,
  });
  expect(toolText(result)).toBe(
    '{"ok":true,"artifact":"plan","path":"plan.json","schemaVersion":1,"title":"First playable quiz","pieceCount":3}',
  );
  expect(readFileSync(CairnDir.planPath(activeProject.path), "utf8")).toContain(
    '"artifact": "plan"',
  );
  expect(() =>
    readFileSync(join(CairnDir.root(activeProject.path), "plan.html"), "utf8"),
  ).toThrow();
});

test("update_project_context tool writes only hidden project context", async () => {
  const store = new ProjectStore();
  const activeProject = store.create(
    tempProjectPath(),
    "Temporary quiz idea",
    new Date("2026-04-28T10:00:00.000Z"),
  );
  const updateContext = createCairnTools({
    getActiveProject: () => activeProject,
    renameProject: () => {
      throw new Error("should not rename while updating project context");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while updating project context");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while updating project context",
      );
    },
    onCreatingStart: () => {
      throw new Error(
        "should not emit creating state while updating project context",
      );
    },
  }).find((tool) => tool.name === "update_project_context");

  expect(updateContext).toBeDefined();
  if (!updateContext) {
    throw new Error("update_project_context tool was not registered");
  }
  expect(updateContext.executionMode).toBe("sequential");
  expect(updateContext.promptGuidelines?.join("\n")).toContain(
    "not a user-visible artifact",
  );

  const result = await updateContext.execute(
    "tool-call-1",
    {
      terms: [
        {
          name: "Instructor",
          definition: "The person creating lightweight checks for a team.",
        },
      ],
      constraints: ["Never expose engineering scaffolding in the panel."],
      decisions: ["Start with one video and one quiz."],
      open_questions: ["Who reviews generated questions?"],
    },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toEqual({
    ok: true,
    path: "CONTEXT.md",
    termCount: 1,
    constraintCount: 1,
    decisionCount: 1,
    openQuestionCount: 1,
  });
  expect(toolText(result)).toBe(
    '{"ok":true,"path":"CONTEXT.md","termCount":1,"constraintCount":1,"decisionCount":1,"openQuestionCount":1}',
  );
  expect(
    readFileSync(CairnDir.projectContextPath(activeProject.path), "utf8"),
  ).toContain("**Instructor**:");
  expect(
    existsSync(join(CairnDir.root(activeProject.path), "context.json")),
  ).toBe(false);
});
