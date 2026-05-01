import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectPhase =
  | "scoping"
  | "scoped"
  | "slicing-prd-done"
  | "sliced"
  | "implementing"
  | "implemented";

export type ProjectState = {
  brief: boolean;
  prds: string[];
  issues: string[];
  phase: ProjectPhase;
};

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

const LI_ELEMENT = /<li\b[^>]*>[\s\S]*?<\/li>/gi;

function checkboxStates(html: string): boolean[] {
  const states = Array.from(html.matchAll(/<input\b[^>]*>/gi))
    .map((match) => match[0])
    .filter((tag) => /\btype\s*=\s*["']?checkbox["']?/i.test(tag))
    .map((tag) => /\bchecked\b/i.test(tag));
  if (states.length > 0) return states;

  return Array.from(html.matchAll(LI_ELEMENT)).map((match) => {
    const openTag = /<li\b[^>]*>/i.exec(match[0])?.[0] ?? "";
    const classValue = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(openTag)?.[2] ?? "";
    const classes = classValue.split(/\s+/).filter(Boolean);
    return classes.includes("checked") || classes.includes("done");
  });
}

function deriveTasksPhase(projectPath: string): ProjectPhase | null {
  const tasksPath = join(projectPath, "tasks.html");
  if (!existsSync(tasksPath)) return null;

  const html = readFileSync(tasksPath, "utf8");
  if (!html.trim()) return null;

  const states = checkboxStates(html);
  if (states.length === 0) return null;
  return states.every(Boolean) ? "implemented" : "implementing";
}

export function getProjectState(projectPath: string): ProjectState {
  const brief = existsSync(join(projectPath, "brief.html"));
  const prds = listMarkdown(join(projectPath, "prds"));
  const issues = listMarkdown(join(projectPath, "issues"));

  let phase: ProjectPhase;
  if (!brief) phase = "scoping";
  else if (prds.length === 0) phase = "scoped";
  else if (issues.length === 0) phase = "slicing-prd-done";
  else phase = deriveTasksPhase(projectPath) ?? "sliced";

  return { brief, prds, issues, phase };
}
