import {
  type AgentToolResult,
  defineTool,
  type Skill,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import {
  createTasksArtifactToolParamsSchema,
  PlanArtifactToolParamsSchema,
  paramsToBriefData,
  paramsToPlanData,
  paramsToTaskIssues,
  updateBriefArtifactToolParamsSchema,
  updatePlanArtifactToolParamsSchema,
  updateTaskStatusToolParamsSchema,
} from "../artifacts/artifact-tool-params";
import {
  type BriefArtifactData,
  BriefArtifactDataSchema,
  type BriefArtifactResult,
  createBriefArtifact,
  updateBriefArtifact,
} from "../artifacts/brief-artifact";
import {
  createPlanArtifact,
  type PlanArtifactData,
  type PlanArtifactResult,
  updatePlanArtifact,
} from "../artifacts/plan-artifact";
import {
  type CreateTasksArtifactIssue,
  type CreateTasksArtifactResult,
  createTasksArtifact,
  type TaskStatus,
  type UpdateTaskStatusResult,
  updateTaskStatus,
} from "../artifacts/tasks-artifact";
import { toolSchemaFromZod } from "../artifacts/tool-schema";
import {
  type ProjectContextResult,
  ProjectContextUpdateToolParamsSchema,
  paramsToProjectContextUpdates,
  updateProjectContext,
} from "../project/project-context";
import type { Project, ProjectRenameResult } from "../project/project-store";
import {
  type AskUserQuestionBundle,
  type AskUserQuestionResult,
  AskUserQuestionToolParamsSchema,
  type AskUserQuestionValidationResult,
  validateQuestionnaire,
} from "../questions/ask-user-question-schema";
import {
  SPAWN_SUBAGENT_RESPONSE_SCHEMAS,
  SPAWN_SUBAGENT_SKILL_NAMES,
  type SpawnSubagentResult,
  spawnSubagent as spawnSubagentInProject,
} from "../subagents/spawn-subagent";

const CREATING_TARGETS = ["brief", "prd", "issues", "plan", "tasks"] as const;

export type CreatingTarget = (typeof CREATING_TARGETS)[number];

export type CairnToolsOptions = {
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
  updateProjectContext?: (input: {
    projectRoot: string;
    updates: ReturnType<typeof paramsToProjectContextUpdates>;
  }) => ProjectContextResult | Promise<ProjectContextResult>;
  askUserQuestion?: (input: {
    toolCallId: string;
    questions: AskUserQuestionBundle;
  }) => Promise<AskUserQuestionResult>;
};

type AskUserQuestionToolDetails =
  | AskUserQuestionResult
  | AskUserQuestionValidationResult;

const setProjectNameParamsSchema = z.object({
  name: z.string().describe("The project name exactly as the user gave it."),
});

const setCreatingParamsSchema = z.object({
  target: z
    .enum(CREATING_TARGETS)
    .describe("The kind of user-visible artifact being created."),
  message: z
    .string()
    .describe(
      "Short Cairn-voice text to show while the artifact is being created.",
    ),
});

const spawnSubagentParamsSchema = z.object({
  skill_name: z
    .enum(SPAWN_SUBAGENT_SKILL_NAMES)
    .describe("The known Cairn skill to run in isolation."),
  args: z
    .record(z.string(), z.unknown())
    .describe("Structured arguments for the named skill."),
  response_schema: z
    .enum(SPAWN_SUBAGENT_RESPONSE_SCHEMAS)
    .describe(
      'Expected structured response shape: "task_outcome", "verify_result", or "artifact_write".',
    ),
});

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

function noActiveProjectContextResult(): ProjectContextResult {
  return {
    ok: false,
    code: "no_active_project",
    message: "No active project is open.",
  };
}

export function createCairnTools(options: CairnToolsOptions): ToolDefinition[] {
  // Cairn-specific tools live beside pi's filesystem tools via `customTools`.
  // Keep each tool thin: validate/write domain state in deep modules, update
  // sidecar runtime state through explicit callbacks, and return a short phrase
  // the persona can fold into its own voice. Artifact-writing work such as PRDs
  // and issues ships as skills; tools stay reserved for declared side effects.
  return [
    defineTool({
      name: "ask_user_question",
      label: "Ask User Question",
      description:
        "Ask the user one to four grouped single-select questions with two to four concrete options each, then wait for structured answers or a cancellation. Adapted from @juicesharp/rpiv-ask-user-question (MIT) for Cairn's React question card.",
      promptSnippet: "Ask grouped clarifying questions",
      promptGuidelines: [
        "Use ask_user_question when the user needs to make a real decision and clear choices will move Scoping, Slicing, or implementation forward.",
        "Prefer one grouped question card over several single-question chat turns when the decisions are related and the user should see the trade-offs together.",
        "Write short option labels and concrete descriptions that explain what choosing that option means.",
        'Do not author reserved option labels such as "Other" or "Type something."; the React question card owns those sentinel labels.',
        "Do not use this for casual clarifications, simple yes/no checks, or questions where freeform conversation is more natural.",
        "If the result is cancelled, acknowledge that and continue in chat without re-asking the same card.",
      ],
      parameters: toolSchemaFromZod(AskUserQuestionToolParamsSchema),
      executionMode: "sequential",
      async execute(
        toolCallId,
        params,
      ): Promise<AgentToolResult<AskUserQuestionToolDetails>> {
        const parsed = AskUserQuestionToolParamsSchema.parse(params);
        const validation = validateQuestionnaire(parsed);
        if (!validation.ok) {
          return {
            content: [{ type: "text", text: JSON.stringify(validation) }],
            details: validation,
          };
        }
        const result = options.askUserQuestion
          ? await options.askUserQuestion({
              toolCallId,
              questions: parsed.questions,
            })
          : ({
              cancelled: true,
              answers: [],
            } satisfies AskUserQuestionResult);

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "create_brief_artifact",
      label: "Create Brief Artifact",
      description:
        "Create the Project Brief as schema-validated artifact data in brief.json. Use this instead of raw artifact writes.",
      promptSnippet: "Create the schema-validated Brief artifact",
      promptGuidelines: [
        "Call create_brief_artifact when Scoping is complete and the Brief is ready to save.",
        "Provide only plain-language content the user should see in the Project tab.",
        "Do not write Brief artifact files directly; this tool owns brief.json, the file envelope, and validation.",
        "Use structured validation failures to fix the named field and retry once when the missing content is obvious.",
      ],
      parameters: toolSchemaFromZod(BriefArtifactDataSchema),
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
        "Do not write Brief artifact files directly; this tool owns brief.json, the file envelope, and validation.",
      ],
      parameters: toolSchemaFromZod(updateBriefArtifactToolParamsSchema),
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
        "Create the current Slice Plan as schema-validated artifact data in plan.json. Use this instead of raw artifact writes.",
      promptSnippet: "Create the schema-validated Plan artifact",
      promptGuidelines: [
        "Call create_plan_artifact when Slicing is complete and the user-visible Plan is ready to save.",
        "Provide only plain-language content the user should see in the Plan tab.",
        "Keep pieces aligned with the visible implementation pieces the Tasks tab will later show.",
        "Do not write Plan artifact files directly; this tool owns plan.json, the file envelope, and validation.",
        "Use structured validation failures to fix the named field and retry once when the missing content is obvious.",
      ],
      parameters: toolSchemaFromZod(PlanArtifactToolParamsSchema),
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
        "Do not write Plan artifact files directly; this tool owns plan.json, the file envelope, and validation.",
      ],
      parameters: toolSchemaFromZod(updatePlanArtifactToolParamsSchema),
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
        "Give the current Cairn project a user-facing name after the brief is meaningfully drafted. The name is slugified for storage; do not mention paths or ids to the user.",
      promptSnippet: "Name the current Cairn project",
      promptGuidelines: [
        "After the brief is meaningfully drafted, ask the user what to call the project, then call set_project_name with their answer.",
        "Use the tool result only as private confirmation; acknowledge the name conversationally without mentioning folders, paths, ids, or slug conflicts.",
      ],
      parameters: toolSchemaFromZod(setProjectNameParamsSchema),
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

        const result = options.renameProject(previousProject.path, params.name);
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
        "Create the Tasks tab as schema-validated artifact data in tasks.json. Use this instead of raw artifact writes.",
      promptSnippet: "Create the schema-validated Tasks artifact",
      promptGuidelines: [
        "Call create_tasks_artifact when Implementing begins and the Tasks tab is ready to save.",
        "Pass the ordered issue paths and matching plain-language task titles from the current slice.",
        "The tool derives task slugs from issue paths and starts every task as todo.",
        "Do not write Tasks artifact files directly; this tool owns tasks.json, the file envelope, and validation.",
        "Use structured validation failures to fix the named issue field and retry once when the missing content is obvious.",
      ],
      parameters: toolSchemaFromZod(createTasksArtifactToolParamsSchema),
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
      parameters: toolSchemaFromZod(updateTaskStatusToolParamsSchema),
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
      name: "update_project_context",
      label: "Update Project Context",
      description:
        "Capture durable Project facts, terms, constraints, decisions, and open questions in hidden CONTEXT.md. Use this instead of editing CONTEXT.md directly.",
      promptSnippet: "Update hidden Project context",
      promptGuidelines: [
        "Call update_project_context only for durable Project knowledge Cairn or Sub-agents should remember.",
        "Project context is Engineering scaffolding, not a user-visible artifact; never call set_creating for it.",
        "Use terms for stable vocabulary, constraints for durable boundaries, decisions for settled choices, and open_questions for unresolved product questions.",
        "Do not use this as a progress log. The tool merges updates into the existing CONTEXT.md structure and avoids duplicate append-only noise.",
        "Artifact tools do not update Project context automatically; call this tool explicitly when context should change.",
      ],
      parameters: toolSchemaFromZod(ProjectContextUpdateToolParamsSchema),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const project = options.getActiveProject();
        const result = project
          ? await (options.updateProjectContext ?? updateProjectContext)({
              projectRoot: project.path,
              updates: paramsToProjectContextUpdates(params),
            })
          : noActiveProjectContextResult();

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
        "Tell the project panel that Cairn is creating a user-visible artifact. Use this only immediately before making something the user can see, and never for hidden thinking or ordinary tool work.",
      promptSnippet: "Show that Cairn is creating a user-visible artifact",
      promptGuidelines: [
        "Call set_creating only before creating a user-visible artifact such as the brief, Plan, or Tasks tab, or for the planning moments that create PRDs or issues; do not use it for hidden work or thinking.",
        "Pair the tool call with one short chat line in the same turn, written in your Cairn voice.",
        "Set message to the panel text the user should see: under about 80 characters, conversational, no paths, files, tools, or implementation details.",
        "The indicator auto-clears when the artifact appears; there is no clear_creating tool.",
      ],
      parameters: toolSchemaFromZod(setCreatingParamsSchema),
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
        "Dispatch a headless Cairn Sub-agent with a named skill, structured args, and an expected structured response schema.",
      promptSnippet: "Run isolated skill work in a headless Cairn Sub-agent",
      promptGuidelines: [
        "Use spawn_subagent for isolated skill work; pass a known skill_name, a structured args object, and the response_schema that matches the skill's expected output.",
        "On task_outcome complete, continue the current workflow; on failure retry once if the same call can plausibly succeed; on blocked stop and surface concrete options.",
        "On verify_result ok true, continue; on ok false, treat it as blocked-class.",
        "On artifact_write complete, use the returned path only as private confirmation; on failure or blocked, stop and explain plainly.",
      ],
      parameters: toolSchemaFromZod(spawnSubagentParamsSchema),
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
