import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CairnDir } from "./cairn-dir";

export const BRIEF_ARTIFACT_PATH = "brief.json";
export const BRIEF_SCHEMA_VERSION = 1;

const nonEmptyString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

export const BriefArtifactSectionSchema = z.object(
  {
    heading: nonEmptyString("Brief section heading is required.").describe(
      "Short heading for this Brief section.",
    ),
    body: nonEmptyString("Brief section body is required.").describe(
      "Plain-language body text for this Brief section.",
    ),
  },
  { error: "Brief section is invalid." },
);

export const BriefArtifactDataSchema = z.object(
  {
    title: nonEmptyString("Brief title is required.").describe(
      "Plain-language name for the Project in the Brief.",
    ),
    summary: nonEmptyString("Brief summary is required.").describe(
      "One short paragraph explaining what the Project is.",
    ),
    audience: nonEmptyString("Brief audience is required.").describe(
      "Who this Project is for.",
    ),
    success: nonEmptyString("Brief success is required.").describe(
      "What should feel true when this Project is useful.",
    ),
    sections: z
      .array(BriefArtifactSectionSchema, {
        error: "At least one Brief section is required.",
      })
      .min(1, { error: "At least one Brief section is required." })
      .describe("Brief sections to render in the Project tab."),
  },
  { error: "Brief data is required." },
);

export type BriefArtifactSection = z.infer<typeof BriefArtifactSectionSchema>;
export type BriefArtifactData = z.infer<typeof BriefArtifactDataSchema>;

export type BriefArtifactEnvelope = {
  artifact: "brief";
  schemaVersion: typeof BRIEF_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  lastUpdateReason?: string;
  data: BriefArtifactData;
};

export type BriefArtifactSuccess = {
  ok: true;
  artifact: "brief";
  path: typeof BRIEF_ARTIFACT_PATH;
  schemaVersion: typeof BRIEF_SCHEMA_VERSION;
  title: string;
  sectionCount: number;
};

export type BriefArtifactFailure = {
  ok: false;
  code:
    | "validation_error"
    | "no_active_project"
    | "brief_already_exists"
    | "brief_not_found"
    | "invalid_existing_artifact"
    | "write_failed";
  field?: string;
  message: string;
};

export type BriefArtifactResult = BriefArtifactSuccess | BriefArtifactFailure;

type CreateBriefArtifactInput = {
  projectRoot: string;
  data: BriefArtifactData;
  now?: () => Date;
};

type UpdateBriefArtifactInput = CreateBriefArtifactInput & {
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
): BriefArtifactFailure {
  const issue = error.issues[0];
  return {
    ok: false,
    code: "validation_error",
    field: issuePathToField(baseField, issue?.path ?? []),
    message: issue?.message ?? "Brief data is invalid.",
  };
}

export function validateBriefArtifactData(
  value: unknown,
): BriefArtifactFailure | null {
  const parsed = BriefArtifactDataSchema.safeParse(value);
  return parsed.success ? null : validationFailureFromZod(parsed.error, "data");
}

function normalizeBriefArtifactData(
  data: BriefArtifactData,
): BriefArtifactData {
  return BriefArtifactDataSchema.parse(data);
}

function success(data: BriefArtifactData): BriefArtifactSuccess {
  return {
    ok: true,
    artifact: "brief",
    path: BRIEF_ARTIFACT_PATH,
    schemaVersion: BRIEF_SCHEMA_VERSION,
    title: data.title,
    sectionCount: data.sections.length,
  };
}

function writeEnvelope(
  projectRoot: string,
  envelope: BriefArtifactEnvelope,
): BriefArtifactResult {
  try {
    CairnDir.ensure(projectRoot);
    writeFileSync(
      CairnDir.briefPath(projectRoot),
      `${JSON.stringify(envelope, null, 2)}\n`,
      "utf8",
    );
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Could not save the Brief artifact.",
    };
  }

  return success(envelope.data);
}

export function createBriefArtifact(
  input: CreateBriefArtifactInput,
): BriefArtifactResult {
  if (existsSync(CairnDir.briefPath(input.projectRoot))) {
    return {
      ok: false,
      code: "brief_already_exists",
      field: "brief.json",
      message:
        "The Brief already exists. Use update_brief_artifact to revise it.",
    };
  }

  const validationError = validateBriefArtifactData(input.data);
  if (validationError) return validationError;

  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const data = normalizeBriefArtifactData(input.data);

  return writeEnvelope(input.projectRoot, {
    artifact: "brief",
    schemaVersion: BRIEF_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    data,
  });
}

export function loadBriefArtifact(
  projectRoot: string,
): BriefArtifactEnvelope | null {
  const path = CairnDir.briefPath(projectRoot);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.artifact !== "brief") return null;
  if (parsed.schemaVersion !== BRIEF_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(parsed.createdAt)) return null;
  if (!isNonEmptyString(parsed.updatedAt)) return null;
  if (validateBriefArtifactData(parsed.data)) return null;

  return parsed as BriefArtifactEnvelope;
}

export function updateBriefArtifact(
  input: UpdateBriefArtifactInput,
): BriefArtifactResult {
  if (!isNonEmptyString(input.reason)) {
    return {
      ok: false,
      code: "validation_error",
      field: "reason",
      message: "Update reason is required.",
    };
  }

  const existing = loadBriefArtifact(input.projectRoot);
  if (!existing) {
    if (existsSync(CairnDir.briefPath(input.projectRoot))) {
      return {
        ok: false,
        code: "invalid_existing_artifact",
        field: "brief.json",
        message: "The existing Brief artifact is invalid.",
      };
    }

    return {
      ok: false,
      code: "brief_not_found",
      field: "brief.json",
      message: "Create the Brief before updating it.",
    };
  }

  const validationError = validateBriefArtifactData(input.data);
  if (validationError) return validationError;

  const data = normalizeBriefArtifactData(input.data);
  return writeEnvelope(input.projectRoot, {
    artifact: "brief",
    schemaVersion: BRIEF_SCHEMA_VERSION,
    createdAt: existing.createdAt,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    lastUpdateReason: input.reason.trim(),
    data,
  });
}
