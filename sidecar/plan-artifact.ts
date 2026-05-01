import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PLAN_ARTIFACT_PATH = "plan.json";
export const PLAN_SCHEMA_VERSION = 1;

export type PlanArtifactData = {
  title: string;
  summary: string;
  fromBrief: string;
  outcomes: string[];
  pieces: string[];
  notYet: string[];
};

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

function validateStringField(
  value: unknown,
  field: keyof PlanArtifactData,
  label: string,
): PlanArtifactFailure | null {
  if (isNonEmptyString(value)) return null;
  return {
    ok: false,
    code: "validation_error",
    field: `data.${field}`,
    message: `${label} is required.`,
  };
}

function validateStringList(
  value: unknown,
  field: keyof PlanArtifactData,
  label: string,
  options: { minItems?: number; maxItems?: number } = {},
): PlanArtifactFailure | null {
  const minItems = options.minItems ?? 1;
  if (!Array.isArray(value) || value.length < minItems) {
    return {
      ok: false,
      code: "validation_error",
      field: `data.${field}`,
      message:
        minItems === 1
          ? `At least one ${label} is required.`
          : `At least ${minItems} ${label}s are required.`,
    };
  }

  if (options.maxItems !== undefined && value.length > options.maxItems) {
    return {
      ok: false,
      code: "validation_error",
      field: `data.${field}`,
      message: `At most ${options.maxItems} ${label}s are allowed.`,
    };
  }

  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      return {
        ok: false,
        code: "validation_error",
        field: `data.${field}.${index}`,
        message: `${label} must not be empty.`,
      };
    }
  }

  return null;
}

export function validatePlanArtifactData(
  value: unknown,
): PlanArtifactFailure | null {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: "validation_error",
      field: "data",
      message: "Plan data is required.",
    };
  }

  const stringError =
    validateStringField(value.title, "title", "Plan title") ??
    validateStringField(value.summary, "summary", "Plan summary") ??
    validateStringField(value.fromBrief, "fromBrief", "Plan brief connection");
  if (stringError) return stringError;

  return (
    validateStringList(value.outcomes, "outcomes", "Plan outcome") ??
    validateStringList(value.pieces, "pieces", "Plan piece", {
      minItems: 3,
      maxItems: 6,
    }) ??
    validateStringList(value.notYet, "notYet", "Plan not-yet item", {
      minItems: 2,
      maxItems: 4,
    })
  );
}

function normalizeList(value: string[]) {
  return value.map((item) => item.trim());
}

function normalizePlanArtifactData(data: PlanArtifactData): PlanArtifactData {
  return {
    title: data.title.trim(),
    summary: data.summary.trim(),
    fromBrief: data.fromBrief.trim(),
    outcomes: normalizeList(data.outcomes),
    pieces: normalizeList(data.pieces),
    notYet: normalizeList(data.notYet),
  };
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
    writeFileSync(
      join(projectRoot, PLAN_ARTIFACT_PATH),
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
  if (existsSync(join(input.projectRoot, PLAN_ARTIFACT_PATH))) {
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
  const path = join(projectRoot, PLAN_ARTIFACT_PATH);
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
    if (existsSync(join(input.projectRoot, PLAN_ARTIFACT_PATH))) {
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
