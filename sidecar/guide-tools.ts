import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Project, ProjectRenameResult } from "./project-store";

export type GuideToolsOptions = {
	getActiveProject: () => Project | null;
	renameProject: (id: string, displayName: string) => ProjectRenameResult;
	onRenameSuccess: (previousProject: Project, nextProject: Project) => void;
	onProjectUpdate: (project: Project) => void;
};

export function createGuideTools(options: GuideToolsOptions): ToolDefinition[] {
	// Guide-specific tools live beside pi's filesystem tools via `customTools`.
	// Keep each tool thin: validate/write domain state in deep modules, update
	// sidecar runtime state through explicit callbacks, and return a short phrase
	// the persona can fold into its own voice. Future Guide tools such as
	// write_prd or write_issue should follow this same sidecar-local pattern
	// instead of leaking paths or implementation details into the persona prompt.
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
	];
}
