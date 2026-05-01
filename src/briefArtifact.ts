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
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  data: BriefArtifactData;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBriefArtifactData(value: unknown): value is BriefArtifactData {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.title)) return false;
  if (!isNonEmptyString(value.summary)) return false;
  if (!isNonEmptyString(value.audience)) return false;
  if (!isNonEmptyString(value.success)) return false;
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    return false;
  }

  return value.sections.every(
    (section) =>
      isRecord(section) &&
      isNonEmptyString(section.heading) &&
      isNonEmptyString(section.body),
  );
}

export function parseBriefArtifact(raw: string): BriefArtifactEnvelope | null {
  if (!raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.artifact !== "brief") return null;
  if (parsed.schemaVersion !== 1) return null;
  if (!isNonEmptyString(parsed.createdAt)) return null;
  if (!isNonEmptyString(parsed.updatedAt)) return null;
  if (!isBriefArtifactData(parsed.data)) return null;

  return parsed as BriefArtifactEnvelope;
}
