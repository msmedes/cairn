import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Project, ProjectRenameResult } from "./project-store";
import {
  type StartTaskResult,
  startTask as startTaskInProject,
} from "./start-task";

export type CreatingTarget = "brief" | "prd" | "issues" | "plan" | "tasks";

export type GuideToolsOptions = {
  getActiveProject: () => Project | null;
  renameProject: (id: string, displayName: string) => ProjectRenameResult;
  onRenameSuccess: (previousProject: Project, nextProject: Project) => void;
  onProjectUpdate: (project: Project) => void;
  onCreatingStart: (target: CreatingTarget, message: string) => void;
  startTask?: (input: {
    projectRoot: string;
    issuePath: string;
    signal?: AbortSignal;
  }) => Promise<StartTaskResult>;
};

export function createGuideTools(options: GuideToolsOptions): ToolDefinition[] {
  // Guide-specific tools live beside pi's filesystem tools via `customTools`.
  // Keep each tool thin: validate/write domain state in deep modules, update
  // sidecar runtime state through explicit callbacks, and return a short phrase
  // the persona can fold into its own voice. Artifact-writing work such as PRDs
  // and issues ships as skills; tools stay reserved for declared side effects.
  return [
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
      name: "start_task",
      label: "Start Task",
      description:
        "Dispatch a headless Guide Sub-agent to implement one named issue file in the active project. The target is a project-relative issue path, never a free-form prompt.",
      promptSnippet: "Start implementing one Tasks tab piece",
      promptGuidelines: [
        "For each Tasks tab piece, write one short chat line in your Guide voice before calling start_task.",
        "Pass the project-relative issuePath for the matching issue file; do not pass implementation instructions or a free-form prompt.",
        "On outcome complete, tick the matching Tasks tab entry and continue to the next piece.",
        "On outcome failure, write one short retry line and retry the same piece; after two consecutive failures, treat the piece as blocked.",
        "On outcome blocked, stop dispatching and surface the situation in plain language with concrete options.",
      ],
      parameters: Type.Object(
        {
          issuePath: Type.String({
            description:
              "Project-relative path to the issue file for this piece, for example issues/06-2-start-task.md.",
          }),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_toolCallId, params, signal) {
        const project = options.getActiveProject();
        if (!project) {
          const result: StartTaskResult = {
            outcome: "blocked",
            message: "No active project is open.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        }

        const result = await (options.startTask ?? startTaskInProject)({
          projectRoot: project.path,
          issuePath: params.issuePath,
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
