import { z } from "zod";
import {
  type BriefArtifactData,
  BriefArtifactDataSchema,
} from "./brief-artifact";
import { type PlanArtifactData, PlanArtifactDataSchema } from "./plan-artifact";
import { type CreateTasksArtifactIssue, TASK_STATUSES } from "./tasks-artifact";

const reasonSchema = z
  .string({ error: "Update reason is required." })
  .trim()
  .min(1, { error: "Update reason is required." })
  .describe("Short private reason for revising the artifact.");

export const updateBriefArtifactToolParamsSchema =
  BriefArtifactDataSchema.extend({
    reason: reasonSchema.describe(
      "Short private reason for revising the Brief.",
    ),
  });

export const PlanArtifactToolParamsSchema = z.object({
  title: PlanArtifactDataSchema.shape.title,
  summary: PlanArtifactDataSchema.shape.summary,
  from_brief: PlanArtifactDataSchema.shape.fromBrief.describe(
    "How this first slice connects back to the Project Brief.",
  ),
  outcomes: PlanArtifactDataSchema.shape.outcomes,
  pieces: PlanArtifactDataSchema.shape.pieces,
  not_yet: PlanArtifactDataSchema.shape.notYet.describe(
    "User-visible items that are not part of this slice.",
  ),
});

export const updatePlanArtifactToolParamsSchema =
  PlanArtifactToolParamsSchema.extend({
    reason: reasonSchema.describe(
      "Short private reason for revising the Plan.",
    ),
  });

const TaskIssueToolParamsSchema = z.object({
  issue_path: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Project-relative issue path such as issues/01-create-the-first-quiz-draft.md.",
    ),
  title: z
    .string()
    .trim()
    .min(1)
    .describe("Plain-language Tasks tab entry matching this issue."),
});

export const createTasksArtifactToolParamsSchema = z.object({
  issues: z
    .array(TaskIssueToolParamsSchema)
    .min(1)
    .describe(
      "Ordered issue path and plain-language task title pairs for the Tasks tab.",
    ),
});

export const updateTaskStatusToolParamsSchema = z.object({
  task_slug: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Issue-derived task slug, for example create-the-first-quiz-draft.",
    ),
  status: z
    .enum(TASK_STATUSES)
    .describe("The next task status: todo, in_progress, done, or blocked."),
});

export function paramsToBriefData(
  params: BriefArtifactData,
): BriefArtifactData {
  return {
    title: params.title,
    summary: params.summary,
    audience: params.audience,
    success: params.success,
    sections: params.sections,
  };
}

type PlanToolParams = z.infer<typeof PlanArtifactToolParamsSchema>;

export function paramsToPlanData(params: PlanToolParams): PlanArtifactData {
  return {
    title: params.title,
    summary: params.summary,
    fromBrief: params.from_brief,
    outcomes: params.outcomes,
    pieces: params.pieces,
    notYet: params.not_yet,
  };
}

type CreateTasksToolParams = z.infer<
  typeof createTasksArtifactToolParamsSchema
>;

export function paramsToTaskIssues(
  params: CreateTasksToolParams,
): CreateTasksArtifactIssue[] {
  return params.issues.map((issue) => ({
    issuePath: issue.issue_path,
    title: issue.title,
  }));
}
