import { Type } from "@mariozechner/pi-ai";
import {
  defineTool,
  type Skill,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import {
  type BriefArtifactData,
  type BriefArtifactResult,
  createBriefArtifact,
  updateBriefArtifact,
} from "./brief-artifact";
import {
  createPlanArtifact,
  type PlanArtifactData,
  type PlanArtifactResult,
  updatePlanArtifact,
} from "./plan-artifact";
import type { Project, ProjectRenameResult } from "./project-store";
import {
  SPAWN_SUBAGENT_RESPONSE_SCHEMAS,
  SPAWN_SUBAGENT_SKILL_NAMES,
  type SpawnSubagentResult,
  spawnSubagent as spawnSubagentInProject,
} from "./spawn-subagent";
import {
  type CreateTasksArtifactIssue,
  type CreateTasksArtifactResult,
  createTasksArtifact,
  TASK_STATUSES,
  type TaskStatus,
  type UpdateTaskStatusResult,
  updateTaskStatus,
} from "./tasks-artifact";

export type CreatingTarget = "brief" | "prd" | "issues" | "plan" | "tasks";

export type GuideToolsOptions = {
  getActiveProject: () => Project | null;
  renameProject: (id: string, displayName: string) => ProjectRenameResult;
  onRenameSuccess: (previousProject: Project, nextProject: Project) => void;
  onProjectUpdate: (project: Project) => void;
  onCreatingStart: (target: CreatingTarget, message: string) => void;
  getLoadedSkills?: () => Skill[];
  spawnSubagent?: (input: {
    projectRoot: string;
    skillName: (typeof SPAWN_SUBAGENT_SKILL_NAMES)[number];
    args: Record<string, unknown>;
    responseSchema: (typeof SPAWN_SUBAGENT_RESPONSE_SCHEMAS)[number];
    loadedSkills: Skill[];
    signal?: AbortSignal;
  }) => Promise<SpawnSubagentResult>;
  createBriefArtifact?: (input: {
    projectRoot: string;
    data: BriefArtifactData;
  }) => BriefArtifactResult | Promise<BriefArtifactResult>;
  updateBriefArtifact?: (input: {
    projectRoot: string;
    data: BriefArtifactData;
    reason: string;
  }) => BriefArtifactResult | Promise<BriefArtifactResult>;
  createPlanArtifact?: (input: {
    projectRoot: string;
    data: PlanArtifactData;
  }) => PlanArtifactResult | Promise<PlanArtifactResult>;
  updatePlanArtifact?: (input: {
    projectRoot: string;
    data: PlanArtifactData;
    reason: string;
  }) => PlanArtifactResult | Promise<PlanArtifactResult>;
  createTasksArtifact?: (input: {
    projectRoot: string;
    issues: CreateTasksArtifactIssue[];
  }) => CreateTasksArtifactResult | Promise<CreateTasksArtifactResult>;
  updateTaskStatus?: (input: {
    projectRoot: string;
    taskSlug: string;
    status: TaskStatus;
  }) => UpdateTaskStatusResult | Promise<UpdateTaskStatusResult>;
};

const briefSectionParameters = Type.Object(
  {
    heading: Type.String({
      description: "Short heading for this Brief section.",
      minLength: 1,
    }),
    body: Type.String({
      description: "Plain-language body text for this Brief section.",
      minLength: 1,
    }),
  },
  { additionalProperties: false },
);

const briefArtifactParameters = {
  title: Type.String({
    description: "Plain-language name for the Project in the Brief.",
    minLength: 1,
  }),
  summary: Type.String({
    description: "One short paragraph explaining what the Project is.",
    minLength: 1,
  }),
  audience: Type.String({
    description: "Who this Project is for.",
    minLength: 1,
  }),
  success: Type.String({
    description: "What should feel true when this Project is useful.",
    minLength: 1,
  }),
  sections: Type.Array(briefSectionParameters, {
    description: "Brief sections to render in the Project tab.",
    minItems: 1,
  }),
};

const planArtifactParameters = {
  title: Type.String({
    description: "Plain-language name for the current first slice.",
    minLength: 1,
  }),
  summary: Type.String({
    description: "One short paragraph explaining what this slice builds first.",
    minLength: 1,
  }),
  from_brief: Type.String({
    description: "How this first slice connects back to the Project Brief.",
    minLength: 1,
  }),
  outcomes: Type.Array(
    Type.String({
      description: "A concrete capability the user will have after this slice.",
      minLength: 1,
    }),
    {
      description: "Visible user outcomes for this slice.",
      minItems: 1,
    },
  ),
  pieces: Type.Array(
    Type.String({
      description: "One plain-language piece the Guide will work through.",
      minLength: 1,
    }),
    {
      description: "Ordered visible pieces for this slice.",
      minItems: 3,
      maxItems: 6,
    },
  ),
  not_yet: Type.Array(
    Type.String({
      description: "A Brief item intentionally not included in this slice.",
      minLength: 1,
    }),
    {
      description: "User-visible items that are not part of this slice.",
      minItems: 2,
      maxItems: 4,
    },
  ),
};

const taskIssueParameters = Type.Object(
  {
    issue_path: Type.String({
      description:
        "Project-relative issue path such as issues/01-create-the-first-quiz-draft.md.",
      minLength: 1,
    }),
    title: Type.String({
      description: "Plain-language Tasks tab entry matching this issue.",
      minLength: 1,
    }),
  },
  { additionalProperties: false },
);

function paramsToBriefData(params: BriefArtifactData): BriefArtifactData {
  return {
    title: params.title,
    summary: params.summary,
    audience: params.audience,
    success: params.success,
    sections: params.sections,
  };
}

type PlanToolParams = {
  title: string;
  summary: string;
  from_brief: string;
  outcomes: string[];
  pieces: string[];
  not_yet: string[];
};

function paramsToPlanData(params: PlanToolParams): PlanArtifactData {
  return {
    title: params.title,
    summary: params.summary,
    fromBrief: params.from_brief,
    outcomes: params.outcomes,
    pieces: params.pieces,
    notYet: params.not_yet,
  };
}

type CreateTasksToolParams = {
  issues: Array<{
    issue_path: string;
    title: string;
  }>;
};

function paramsToTaskIssues(
  params: CreateTasksToolParams,
): CreateTasksArtifactIssue[] {
  return params.issues.map((issue) => ({
    issuePath: issue.issue_path,
    title: issue.title,
  }));
}

function noActiveProjectBriefResult(): BriefArtifactResult {
  return {
    ok: false,
    code: "no_active_project",
    message: "No active project is open.",
  };
}

function noActiveProjectPlanResult(): PlanArtifactResult {
  return {
    ok: false,
    code: "no_active_project",
    message: "No active project is open.",
  };
}

function noActiveProjectTasksResult(): CreateTasksArtifactResult {
  return {
    ok: false,
    code: "no_active_project",
    message: "No active project is open.",
  };
}

function noActiveProjectTaskStatusResult(): UpdateTaskStatusResult {
  return {
    ok: false,
    code: "no_active_project",
    message: "No active project is open.",
  };
}

export function createGuideTools(options: GuideToolsOptions): ToolDefinition[] {
  // Guide-specific tools live beside pi's filesystem tools via `customTools`.
  // Keep each tool thin: validate/write domain state in deep modules, update
  // sidecar runtime state through explicit callbacks, and return a short phrase
  // the persona can fold into its own voice. Artifact-writing work such as PRDs
  // and issues ships as skills; tools stay reserved for declared side effects.
  return [
    defineTool({
      name: "create_brief_artifact",
      label: "Create Brief Artifact",
      description:
        "Create the Project Brief as schema-validated artifact data in brief.json. Use this instead of writing brief.html, brief.md, or raw JSON yourself.",
      promptSnippet: "Create the schema-validated Brief artifact",
      promptGuidelines: [
        "Call create_brief_artifact when Scoping is complete and the Brief is ready to save.",
        "Provide only plain-language content the user should see in the Project tab.",
        "Do not write brief.html, brief.md, or brief.json directly; this tool owns the file envelope and validation.",
        "Use structured validation failures to fix the named field and retry once when the missing content is obvious.",
      ],
      parameters: Type.Object(briefArtifactParameters, {
        additionalProperties: false,
      }),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.createBriefArtifact ?? createBriefArtifact)({
              projectRoot: project.path,
              data: paramsToBriefData(params),
            })
          : noActiveProjectBriefResult();

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "update_brief_artifact",
      label: "Update Brief Artifact",
      description:
        "Replace the Project Brief artifact data in brief.json after the user changes the agreement. Requires a short reason.",
      promptSnippet: "Update the schema-validated Brief artifact",
      promptGuidelines: [
        "Call update_brief_artifact only when revising an existing Brief agreement.",
        "Include a short reason that explains what changed, without exposing paths or implementation details.",
        "Provide the complete replacement Brief content; partial patch updates are not supported.",
        "Do not write brief.html, brief.md, or brief.json directly; this tool owns the file envelope and validation.",
      ],
      parameters: Type.Object(
        {
          ...briefArtifactParameters,
          reason: Type.String({
            description: "Short private reason for revising the Brief.",
            minLength: 1,
          }),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.updateBriefArtifact ?? updateBriefArtifact)({
              projectRoot: project.path,
              data: paramsToBriefData(params),
              reason: params.reason,
            })
          : noActiveProjectBriefResult();

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "create_plan_artifact",
      label: "Create Plan Artifact",
      description:
        "Create the current Slice Plan as schema-validated artifact data in plan.json. Use this instead of writing plan.html, plan.md, or raw JSON yourself.",
      promptSnippet: "Create the schema-validated Plan artifact",
      promptGuidelines: [
        "Call create_plan_artifact when Slicing is complete and the user-visible Plan is ready to save.",
        "Provide only plain-language content the user should see in the Plan tab.",
        "Keep pieces aligned with the visible implementation pieces the Tasks tab will later show.",
        "Do not write plan.html, plan.md, or plan.json directly; this tool owns the file envelope and validation.",
        "Use structured validation failures to fix the named field and retry once when the missing content is obvious.",
      ],
      parameters: Type.Object(planArtifactParameters, {
        additionalProperties: false,
      }),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.createPlanArtifact ?? createPlanArtifact)({
              projectRoot: project.path,
              data: paramsToPlanData(params),
            })
          : noActiveProjectPlanResult();

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "update_plan_artifact",
      label: "Update Plan Artifact",
      description:
        "Replace the current Slice Plan artifact data in plan.json after the user changes the agreement. Requires a short reason.",
      promptSnippet: "Update the schema-validated Plan artifact",
      promptGuidelines: [
        "Call update_plan_artifact only when revising an existing Plan agreement.",
        "Include a short reason that explains what changed, without exposing paths or implementation details.",
        "Provide the complete replacement Plan content; partial patch updates are not supported.",
        "Do not write plan.html, plan.md, or plan.json directly; this tool owns the file envelope and validation.",
      ],
      parameters: Type.Object(
        {
          ...planArtifactParameters,
          reason: Type.String({
            description: "Short private reason for revising the Plan.",
            minLength: 1,
          }),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.updatePlanArtifact ?? updatePlanArtifact)({
              projectRoot: project.path,
              data: paramsToPlanData(params),
              reason: params.reason,
            })
          : noActiveProjectPlanResult();

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "set_project_name",
      label: "Set Project Name",
      description:
        "Give the current Guide project a user-facing name after the brief is meaningfully drafted. The name is slugified for storage; do not mention paths or ids to the user.",
      promptSnippet: "Name the current Guide project",
      promptGuidelines: [
        "After the brief is meaningfully drafted, ask the user what to call the project, then call set_project_name with their answer.",
        "Use the tool result only as private confirmation; acknowledge the name conversationally without mentioning folders, paths, ids, or slug conflicts.",
      ],
      parameters: Type.Object({
        name: Type.String({
          description: "The project name exactly as the user gave it.",
        }),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const previousProject = options.getActiveProject();
        if (!previousProject) {
          return {
            content: [
              {
                type: "text",
                text: "I need to start a project before I can name it.",
              },
            ],
            details: { ok: false, projectId: null, displayName: null },
          };
        }

        const result = options.renameProject(previousProject.id, params.name);
        if (result.ok) {
          options.onRenameSuccess(previousProject, result.project);
          options.onProjectUpdate(result.project);
        }

        return {
          content: [{ type: "text", text: result.message }],
          details: {
            ok: result.ok,
            projectId: result.project?.id ?? null,
            displayName: result.project?.displayName ?? null,
          },
        };
      },
    }),
    defineTool({
      name: "create_tasks_artifact",
      label: "Create Tasks Artifact",
      description:
        "Create the Tasks tab as schema-validated artifact data in tasks.json. Use this instead of writing tasks.html or raw JSON yourself.",
      promptSnippet: "Create the schema-validated Tasks artifact",
      promptGuidelines: [
        "Call create_tasks_artifact when Implementing begins and the Tasks tab is ready to save.",
        "Pass the ordered issue paths and matching plain-language task titles from the current slice.",
        "The tool derives task slugs from issue paths and starts every task as todo.",
        "Do not write tasks.html, tasks.md, or tasks.json directly; this tool owns the file envelope and validation.",
        "Use structured validation failures to fix the named issue field and retry once when the missing content is obvious.",
      ],
      parameters: Type.Object(
        {
          issues: Type.Array(taskIssueParameters, {
            description:
              "Ordered issue path and plain-language task title pairs for the Tasks tab.",
            minItems: 1,
          }),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.createTasksArtifact ?? createTasksArtifact)({
              projectRoot: project.path,
              issues: paramsToTaskIssues(params),
            })
          : noActiveProjectTasksResult();

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "update_task_status",
      label: "Update Task Status",
      description:
        "Update one Tasks tab item by issue-derived task slug in tasks.json. Use this for routine implementation progress.",
      promptSnippet: "Update a Tasks tab status by task slug",
      promptGuidelines: [
        'Call update_task_status after each spawn_subagent("implement-issue", ...) result using the matching issue-derived task_slug.',
        "Use status todo, in_progress, done, or blocked; do not rewrite the full Tasks artifact for routine progress.",
        "If update_task_status returns a structured slug failure, stop and explain the short message plainly.",
        "Never use list indexes or raw edits for Tasks tab progress.",
      ],
      parameters: Type.Object(
        {
          task_slug: Type.String({
            description:
              "Issue-derived task slug, for example create-the-first-quiz-draft.",
            minLength: 1,
          }),
          status: Type.Union(
            TASK_STATUSES.map((status) => Type.Literal(status)),
            {
              description:
                "The next task status: todo, in_progress, done, or blocked.",
            },
          ),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.updateTaskStatus ?? updateTaskStatus)({
              projectRoot: project.path,
              taskSlug: params.task_slug,
              status: params.status,
            })
          : noActiveProjectTaskStatusResult();

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "set_creating",
      label: "Show Creating Indicator",
      description:
        "Tell the project panel that the Guide is creating a user-visible artifact. Use this only immediately before making something the user can see, and never for hidden thinking or ordinary tool work.",
      promptSnippet: "Show that the Guide is creating a user-visible artifact",
      promptGuidelines: [
        "Call set_creating only before creating a user-visible artifact such as the brief, Plan, or Tasks tab, or for the planning moments that create PRDs or issues; do not use it for hidden work or thinking.",
        "Pair the tool call with one short chat line in the same turn, written in your Guide voice.",
        "Set message to the panel text the user should see: under about 80 characters, conversational, no paths, files, tools, or implementation details.",
        "The indicator auto-clears when the artifact appears; there is no clear_creating tool.",
      ],
      parameters: Type.Object({
        target: Type.Union(
          [
            Type.Literal("brief"),
            Type.Literal("prd"),
            Type.Literal("issues"),
            Type.Literal("plan"),
            Type.Literal("tasks"),
          ],
          {
            description: "The kind of user-visible artifact being created.",
          },
        ),
        message: Type.String({
          description:
            "Short Guide-voice text to show while the artifact is being created.",
        }),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        options.onCreatingStart(params.target, params.message);

        return {
          content: [
            {
              type: "text",
              text: "Creating indicator is showing.",
            },
          ],
          details: { ok: true, target: params.target },
        };
      },
    }),
    defineTool({
      name: "spawn_subagent",
      label: "Spawn Sub-agent",
      description:
        "Dispatch a headless Guide Sub-agent with a named skill, structured args, and an expected structured response schema.",
      promptSnippet: "Run isolated skill work in a headless Guide Sub-agent",
      promptGuidelines: [
        "Use spawn_subagent for isolated skill work; pass a known skill_name, a structured args object, and the response_schema that matches the skill's expected output.",
        "On task_outcome complete, continue the current workflow; on failure retry once if the same call can plausibly succeed; on blocked stop and surface concrete options.",
        "On verify_result ok true, continue; on ok false, treat it as blocked-class.",
        "On artifact_write complete, use the returned path only as private confirmation; on failure or blocked, stop and explain plainly.",
      ],
      parameters: Type.Object(
        {
          // Keep this literal union in sync with prompts/skills and the
          // dispatcher allowlist in spawn-subagent.ts.
          skill_name: Type.Union(
            SPAWN_SUBAGENT_SKILL_NAMES.map((name) => Type.Literal(name)),
            {
              description: "The known Guide skill to run in isolation.",
            },
          ),
          args: Type.Object(
            {},
            {
              additionalProperties: true,
              description: "Structured arguments for the named skill.",
            },
          ),
          response_schema: Type.Union(
            SPAWN_SUBAGENT_RESPONSE_SCHEMAS.map((name) => Type.Literal(name)),
            {
              description:
                'Expected structured response shape: "task_outcome", "verify_result", or "artifact_write".',
            },
          ),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_toolCallId, params, signal) {
        const project = options.getActiveProject();
        if (!project) {
          const result: SpawnSubagentResult = {
            outcome: "blocked",
            message: "No active project is open.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        }

        const result = await (options.spawnSubagent ?? spawnSubagentInProject)({
          projectRoot: project.path,
          skillName: params.skill_name,
          args: params.args as Record<string, unknown>,
          responseSchema: params.response_schema,
          loadedSkills: options.getLoadedSkills?.() ?? [],
          signal,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
  ];
}
