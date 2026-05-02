import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const PROJECT_CONTEXT_PATH = "CONTEXT.md";

const nonEmptyString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const ProjectContextTermSchema = z.object({
  name: nonEmptyString("Term name is required.").describe(
    "Durable project term or phrase.",
  ),
  definition: nonEmptyString("Term definition is required.").describe(
    "Short definition for Cairn and Sub-agents.",
  ),
});

export const ProjectContextUpdateToolParamsSchema = z.object({
  terms: z
    .array(ProjectContextTermSchema)
    .optional()
    .describe("Durable terms and definitions to add or update."),
  constraints: z
    .array(nonEmptyString("Constraint is required."))
    .optional()
    .describe("Durable project constraints to remember."),
  decisions: z
    .array(nonEmptyString("Decision is required."))
    .optional()
    .describe("Durable product or implementation decisions to remember."),
  open_questions: z
    .array(nonEmptyString("Open question is required."))
    .optional()
    .describe("Open project questions that still need an answer."),
});

export type ProjectContextUpdateToolParams = z.infer<
  typeof ProjectContextUpdateToolParamsSchema
>;

export type ProjectContextTerm = z.infer<typeof ProjectContextTermSchema>;

export type ProjectContext = {
  terms: ProjectContextTerm[];
  constraints: string[];
  decisions: string[];
  openQuestions: string[];
};

export type ProjectContextUpdates = {
  terms?: ProjectContextTerm[];
  constraints?: string[];
  decisions?: string[];
  openQuestions?: string[];
};

export type ProjectContextUpdateInput = {
  projectRoot: string;
  updates: ProjectContextUpdates;
  now?: () => Date;
};

export type ProjectContextSuccess = {
  ok: true;
  path: typeof PROJECT_CONTEXT_PATH;
  termCount: number;
  constraintCount: number;
  decisionCount: number;
  openQuestionCount: number;
};

export type ProjectContextFailure = {
  ok: false;
  code:
    | "validation_error"
    | "empty_update"
    | "no_active_project"
    | "invalid_existing_context"
    | "write_failed";
  field?: string;
  message: string;
};

export type ProjectContextResult =
  | ProjectContextSuccess
  | ProjectContextFailure;

type MarkdownSection = {
  title: string;
  body: string;
};

type ParsedMarkdown = {
  sections: MarkdownSection[];
};

const CONTEXT_TITLE = "# Project Context";
const LANGUAGE_SECTION = "Language";
const CONSTRAINTS_SECTION = "Constraints";
const DECISIONS_SECTION = "Decisions";
const OPEN_QUESTIONS_SECTION = "Open Questions";
const CANONICAL_SECTIONS = [
  LANGUAGE_SECTION,
  CONSTRAINTS_SECTION,
  DECISIONS_SECTION,
  OPEN_QUESTIONS_SECTION,
] as const;

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTerm(term: ProjectContextTerm): ProjectContextTerm {
  return {
    name: normalizeLine(term.name),
    definition: term.definition.trim(),
  };
}

function hasAnyUpdate(updates: ProjectContextUpdates) {
  return (
    (updates.terms?.length ?? 0) > 0 ||
    (updates.constraints?.length ?? 0) > 0 ||
    (updates.decisions?.length ?? 0) > 0 ||
    (updates.openQuestions?.length ?? 0) > 0
  );
}

function bulletKey(value: string) {
  return normalizeLine(value).toLocaleLowerCase();
}

function termKey(term: ProjectContextTerm) {
  return normalizeLine(term.name).toLocaleLowerCase();
}

function parseMarkdown(text: string): ParsedMarkdown | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== CONTEXT_TITLE) return null;

  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  const sectionHeading = /^##\s+(.+?)\s*$/;

  for (const line of lines.slice(1)) {
    const heading = sectionHeading.exec(line);
    if (heading) {
      current = { title: heading[1], body: "" };
      sections.push(current);
      continue;
    }

    if (current) {
      current.body += `${line}\n`;
    }
  }

  for (const sectionTitle of CANONICAL_SECTIONS) {
    if (!sections.some((section) => section.title === sectionTitle)) {
      return null;
    }
  }

  return { sections };
}

function sectionBody(parsed: ParsedMarkdown, title: string) {
  return (
    parsed.sections.find((section) => section.title === title)?.body.trim() ??
    ""
  );
}

function parseTerms(body: string): ProjectContextTerm[] {
  const terms: ProjectContextTerm[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let current: ProjectContextTerm | null = null;
  const termHeading = /^\*\*(.+?)\*\*:\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = termHeading.exec(line);
    if (heading) {
      if (current && isNonEmptyString(current.definition)) {
        terms.push(normalizeTerm(current));
      }
      current = { name: heading[1].trim(), definition: "" };
      continue;
    }

    if (current) {
      current.definition = `${current.definition}${current.definition ? "\n" : ""}${line}`;
    }
  }

  if (current && isNonEmptyString(current.definition)) {
    terms.push(normalizeTerm(current));
  }

  return terms;
}

function parseBullets(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const match = /^-\s+(.+?)\s*$/.exec(line);
      if (!match) return [];
      const value = normalizeLine(match[1]);
      return value.toLocaleLowerCase() === "none yet." ? [] : [value];
    });
}

function projectContextFromParsed(parsed: ParsedMarkdown): ProjectContext {
  return {
    terms: parseTerms(sectionBody(parsed, LANGUAGE_SECTION)),
    constraints: parseBullets(sectionBody(parsed, CONSTRAINTS_SECTION)),
    decisions: parseBullets(sectionBody(parsed, DECISIONS_SECTION)),
    openQuestions: parseBullets(sectionBody(parsed, OPEN_QUESTIONS_SECTION)),
  };
}

function mergeTerms(
  existing: ProjectContextTerm[],
  updates: ProjectContextTerm[] | undefined,
) {
  const termsByKey = new Map<string, ProjectContextTerm>();
  for (const term of existing.map(normalizeTerm)) {
    termsByKey.set(termKey(term), term);
  }
  for (const term of updates ?? []) {
    const normalized = normalizeTerm(term);
    termsByKey.set(termKey(normalized), normalized);
  }
  return [...termsByKey.values()];
}

function mergeBullets(existing: string[], updates: string[] | undefined) {
  const bulletsByKey = new Map<string, string>();
  for (const bullet of existing.map(normalizeLine).filter(isNonEmptyString)) {
    bulletsByKey.set(bulletKey(bullet), bullet);
  }
  for (const bullet of updates ?? []) {
    const normalized = normalizeLine(bullet);
    bulletsByKey.set(bulletKey(normalized), normalized);
  }
  return [...bulletsByKey.values()];
}

function renderTerms(terms: ProjectContextTerm[]) {
  if (terms.length === 0) return "- None yet.";

  return terms
    .map((term) => `**${term.name}**:\n${term.definition}`)
    .join("\n\n");
}

function renderBullets(values: string[]) {
  if (values.length === 0) return "- None yet.";
  return values.map((value) => `- ${value}`).join("\n");
}

function renderSection(title: string, context: ProjectContext) {
  switch (title) {
    case LANGUAGE_SECTION:
      return renderTerms(context.terms);
    case CONSTRAINTS_SECTION:
      return renderBullets(context.constraints);
    case DECISIONS_SECTION:
      return renderBullets(context.decisions);
    case OPEN_QUESTIONS_SECTION:
      return renderBullets(context.openQuestions);
    default:
      return null;
  }
}

function renderContext(
  context: ProjectContext,
  parsedExisting: ParsedMarkdown | null,
) {
  const sections = parsedExisting?.sections ?? [];
  const orderedSections: MarkdownSection[] =
    sections.length > 0
      ? sections
      : CANONICAL_SECTIONS.map((title) => ({ title, body: "" }));
  const existingTitles = new Set(
    orderedSections.map((section) => section.title),
  );

  for (const title of CANONICAL_SECTIONS) {
    if (!existingTitles.has(title)) {
      orderedSections.push({ title, body: "" });
    }
  }

  const rendered = orderedSections.map((section) => {
    const knownBody = renderSection(section.title, context);
    const body = knownBody ?? section.body.trim();
    return `## ${section.title}\n\n${body}`;
  });

  return `${CONTEXT_TITLE}\n\n${rendered.join("\n\n")}\n`;
}

function success(context: ProjectContext): ProjectContextSuccess {
  return {
    ok: true,
    path: PROJECT_CONTEXT_PATH,
    termCount: context.terms.length,
    constraintCount: context.constraints.length,
    decisionCount: context.decisions.length,
    openQuestionCount: context.openQuestions.length,
  };
}

export function paramsToProjectContextUpdates(
  params: ProjectContextUpdateToolParams,
): ProjectContextUpdates {
  return {
    terms: params.terms,
    constraints: params.constraints,
    decisions: params.decisions,
    openQuestions: params.open_questions,
  };
}

export function loadProjectContext(projectRoot: string): ProjectContext | null {
  const path = join(projectRoot, PROJECT_CONTEXT_PATH);
  if (!existsSync(path)) return null;

  try {
    const parsed = parseMarkdown(readFileSync(path, "utf8"));
    return parsed ? projectContextFromParsed(parsed) : null;
  } catch {
    return null;
  }
}

export function updateProjectContext(
  input: ProjectContextUpdateInput,
): ProjectContextResult {
  const parsedUpdates = ProjectContextUpdateToolParamsSchema.safeParse({
    terms: input.updates.terms,
    constraints: input.updates.constraints,
    decisions: input.updates.decisions,
    open_questions: input.updates.openQuestions,
  });
  if (!parsedUpdates.success) {
    const issue = parsedUpdates.error.issues[0];
    return {
      ok: false,
      code: "validation_error",
      field: issue?.path.join("."),
      message: issue?.message ?? "Project context update is invalid.",
    };
  }

  const updates = paramsToProjectContextUpdates(parsedUpdates.data);
  if (!hasAnyUpdate(updates)) {
    return {
      ok: false,
      code: "empty_update",
      message:
        "Provide at least one term, constraint, decision, or open question.",
    };
  }

  const path = join(input.projectRoot, PROJECT_CONTEXT_PATH);
  const existingText = existsSync(path) ? readFileSync(path, "utf8") : null;
  const parsedExisting = existingText ? parseMarkdown(existingText) : null;
  if (existingText && !parsedExisting) {
    return {
      ok: false,
      code: "invalid_existing_context",
      field: PROJECT_CONTEXT_PATH,
      message: "The existing project context is invalid.",
    };
  }

  const existingContext = parsedExisting
    ? projectContextFromParsed(parsedExisting)
    : { terms: [], constraints: [], decisions: [], openQuestions: [] };
  const context: ProjectContext = {
    terms: mergeTerms(existingContext.terms, updates.terms),
    constraints: mergeBullets(existingContext.constraints, updates.constraints),
    decisions: mergeBullets(existingContext.decisions, updates.decisions),
    openQuestions: mergeBullets(
      existingContext.openQuestions,
      updates.openQuestions,
    ),
  };

  try {
    writeFileSync(path, renderContext(context, parsedExisting), "utf8");
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Could not save the project context.",
    };
  }

  return success(context);
}
