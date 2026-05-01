import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BRIEF_ARTIFACT_PATH = "brief.json";
export const BRIEF_SCHEMA_VERSION = 1;

export type BriefArtifactSection = {
  heading: string;
  body: string;
};

export type BriefArtifactData = {
  title: string;
  summary: string;
  audience: string;
  success: string;
  sections: BriefArtifactSection[];
};

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

function validateStringField(
  value: unknown,
  field: keyof BriefArtifactData,
  label: string,
): BriefArtifactFailure | null {
  if (isNonEmptyString(value)) return null;
  return {
    ok: false,
    code: "validation_error",
    field: `data.${field}`,
    message: `${label} is required.`,
  };
}

export function validateBriefArtifactData(
  value: unknown,
): BriefArtifactFailure | null {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: "validation_error",
      field: "data",
      message: "Brief data is required.",
    };
  }

  const stringError =
    validateStringField(value.title, "title", "Brief title") ??
    validateStringField(value.summary, "summary", "Brief summary") ??
    validateStringField(value.audience, "audience", "Brief audience") ??
    validateStringField(value.success, "success", "Brief success");
  if (stringError) return stringError;

  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    return {
      ok: false,
      code: "validation_error",
      field: "data.sections",
      message: "At least one Brief section is required.",
    };
  }

  for (const [index, section] of value.sections.entries()) {
    if (!isRecord(section)) {
      return {
        ok: false,
        code: "validation_error",
        field: `data.sections.${index}`,
        message: "Brief section is invalid.",
      };
    }
    if (!isNonEmptyString(section.heading)) {
      return {
        ok: false,
        code: "validation_error",
        field: `data.sections.${index}.heading`,
        message: "Brief section heading is required.",
      };
    }
    if (!isNonEmptyString(section.body)) {
      return {
        ok: false,
        code: "validation_error",
        field: `data.sections.${index}.body`,
        message: "Brief section body is required.",
      };
    }
  }

  return null;
}

function normalizeBriefArtifactData(
  data: BriefArtifactData,
): BriefArtifactData {
  return {
    title: data.title.trim(),
    summary: data.summary.trim(),
    audience: data.audience.trim(),
    success: data.success.trim(),
    sections: data.sections.map((section) => ({
      heading: section.heading.trim(),
      body: section.body.trim(),
    })),
  };
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
    writeFileSync(
      join(projectRoot, BRIEF_ARTIFACT_PATH),
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
  if (existsSync(join(input.projectRoot, BRIEF_ARTIFACT_PATH))) {
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
  const path = join(projectRoot, BRIEF_ARTIFACT_PATH);
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
    if (existsSync(join(input.projectRoot, BRIEF_ARTIFACT_PATH))) {
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
