import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CairnDir } from "../project/cairn-dir";

export const PLAN_ARTIFACT_PATH = "plan.json";
export const PLAN_SCHEMA_VERSION = 1;

const nonEmptyString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

export const PlanArtifactDataSchema = z.object(
  {
    title: nonEmptyString("Plan title is required.").describe(
      "Plain-language name for the current first slice.",
    ),
    summary: nonEmptyString("Plan summary is required.").describe(
      "One short paragraph explaining what this slice builds first.",
    ),
    fromBrief: nonEmptyString("Plan brief connection is required.").describe(
      "How this first slice connects back to the Project Brief.",
    ),
    outcomes: z
      .array(nonEmptyString("Plan outcome must not be empty."), {
        error: "At least one Plan outcome is required.",
      })
      .min(1, { error: "At least one Plan outcome is required." })
      .describe("Visible user outcomes for this slice."),
    pieces: z
      .array(nonEmptyString("Plan piece must not be empty."), {
        error: "At least 3 Plan pieces are required.",
      })
      .min(3, { error: "At least 3 Plan pieces are required." })
      .max(6, { error: "At most 6 Plan pieces are allowed." })
      .describe("Ordered visible pieces for this slice."),
    notYet: z
      .array(nonEmptyString("Plan not-yet item must not be empty."), {
        error: "At least 2 Plan not-yet items are required.",
      })
      .min(2, { error: "At least 2 Plan not-yet items are required." })
      .max(4, { error: "At most 4 Plan not-yet items are allowed." })
      .describe("User-visible items that are not part of this slice."),
  },
  { error: "Plan data is required." },
);

export type PlanArtifactData = z.infer<typeof PlanArtifactDataSchema>;

export type PlanArtifactEnvelope = {
  artifact: "plan";
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  lastUpdateReason?: string;
  data: PlanArtifactData;
};

export type PlanArtifactSuccess = {
  ok: true;
  artifact: "plan";
  path: typeof PLAN_ARTIFACT_PATH;
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  title: string;
  pieceCount: number;
};

export type PlanArtifactFailure = {
  ok: false;
  code:
    | "validation_error"
    | "no_active_project"
    | "plan_already_exists"
    | "plan_not_found"
    | "invalid_existing_artifact"
    | "write_failed";
  field?: string;
  message: string;
};

export type PlanArtifactResult = PlanArtifactSuccess | PlanArtifactFailure;

type CreatePlanArtifactInput = {
  projectRoot: string;
  data: PlanArtifactData;
  now?: () => Date;
};

type UpdatePlanArtifactInput = CreatePlanArtifactInput & {
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function issuePathToField(base: string, path: PropertyKey[]) {
  if (path.length === 0) return base;
  return `${base}.${path.join(".")}`;
}

function validationFailureFromZod(
  error: z.ZodError,
  baseField: string,
): PlanArtifactFailure {
  const issue = error.issues[0];
  return {
    ok: false,
    code: "validation_error",
    field: issuePathToField(baseField, issue?.path ?? []),
    message: issue?.message ?? "Plan data is invalid.",
  };
}

export function validatePlanArtifactData(
  value: unknown,
): PlanArtifactFailure | null {
  const parsed = PlanArtifactDataSchema.safeParse(value);
  return parsed.success ? null : validationFailureFromZod(parsed.error, "data");
}

function normalizePlanArtifactData(data: PlanArtifactData): PlanArtifactData {
  return PlanArtifactDataSchema.parse(data);
}

function success(data: PlanArtifactData): PlanArtifactSuccess {
  return {
    ok: true,
    artifact: "plan",
    path: PLAN_ARTIFACT_PATH,
    schemaVersion: PLAN_SCHEMA_VERSION,
    title: data.title,
    pieceCount: data.pieces.length,
  };
}

function writeEnvelope(
  projectRoot: string,
  envelope: PlanArtifactEnvelope,
): PlanArtifactResult {
  try {
    CairnDir.ensure(projectRoot);
    writeFileSync(
      CairnDir.planPath(projectRoot),
      `${JSON.stringify(envelope, null, 2)}\n`,
      "utf8",
    );
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Could not save the Plan artifact.",
    };
  }

  return success(envelope.data);
}

export function createPlanArtifact(
  input: CreatePlanArtifactInput,
): PlanArtifactResult {
  if (existsSync(CairnDir.planPath(input.projectRoot))) {
    return {
      ok: false,
      code: "plan_already_exists",
      field: "plan.json",
      message:
        "The Plan already exists. Use update_plan_artifact to revise it.",
    };
  }

  const validationError = validatePlanArtifactData(input.data);
  if (validationError) return validationError;

  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const data = normalizePlanArtifactData(input.data);

  return writeEnvelope(input.projectRoot, {
    artifact: "plan",
    schemaVersion: PLAN_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    data,
  });
}

export function loadPlanArtifact(
  projectRoot: string,
): PlanArtifactEnvelope | null {
  const path = CairnDir.planPath(projectRoot);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.artifact !== "plan") return null;
  if (parsed.schemaVersion !== PLAN_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(parsed.createdAt)) return null;
  if (!isNonEmptyString(parsed.updatedAt)) return null;
  if (validatePlanArtifactData(parsed.data)) return null;

  return parsed as PlanArtifactEnvelope;
}

export function updatePlanArtifact(
  input: UpdatePlanArtifactInput,
): PlanArtifactResult {
  if (!isNonEmptyString(input.reason)) {
    return {
      ok: false,
      code: "validation_error",
      field: "reason",
      message: "Update reason is required.",
    };
  }

  const existing = loadPlanArtifact(input.projectRoot);
  if (!existing) {
    if (existsSync(CairnDir.planPath(input.projectRoot))) {
      return {
        ok: false,
        code: "invalid_existing_artifact",
        field: "plan.json",
        message: "The existing Plan artifact is invalid.",
      };
    }

    return {
      ok: false,
      code: "plan_not_found",
      field: "plan.json",
      message: "Create the Plan before updating it.",
    };
  }

  const validationError = validatePlanArtifactData(input.data);
  if (validationError) return validationError;

  const data = normalizePlanArtifactData(input.data);
  return writeEnvelope(input.projectRoot, {
    artifact: "plan",
    schemaVersion: PLAN_SCHEMA_VERSION,
    createdAt: existing.createdAt,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    lastUpdateReason: input.reason.trim(),
    data,
  });
}
