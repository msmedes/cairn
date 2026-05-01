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
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  data: PlanArtifactData;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringList(
  value: unknown,
  options: { minItems?: number; maxItems?: number } = {},
) {
  const minItems = options.minItems ?? 1;
  return (
    Array.isArray(value) &&
    value.length >= minItems &&
    (options.maxItems === undefined || value.length <= options.maxItems) &&
    value.every((item) => isNonEmptyString(item))
  );
}

function isPlanArtifactData(value: unknown): value is PlanArtifactData {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.title)) return false;
  if (!isNonEmptyString(value.summary)) return false;
  if (!isNonEmptyString(value.fromBrief)) return false;
  if (!isStringList(value.outcomes)) return false;
  if (!isStringList(value.pieces, { minItems: 3, maxItems: 6 })) return false;
  if (!isStringList(value.notYet, { minItems: 2, maxItems: 4 })) return false;
  return true;
}

export function parsePlanArtifact(raw: string): PlanArtifactEnvelope | null {
  if (!raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.artifact !== "plan") return null;
  if (parsed.schemaVersion !== 1) return null;
  if (!isNonEmptyString(parsed.createdAt)) return null;
  if (!isNonEmptyString(parsed.updatedAt)) return null;
  if (!isPlanArtifactData(parsed.data)) return null;

  return parsed as PlanArtifactEnvelope;
}
