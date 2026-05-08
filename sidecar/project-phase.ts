import { existsSync, readdirSync } from "node:fs";
import { loadBriefArtifact } from "./brief-artifact";
import { CairnDir } from "./cairn-dir";
import { loadTasksArtifact } from "./tasks-artifact";

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

function deriveTasksPhase(projectPath: string): ProjectPhase | null {
  const artifact = loadTasksArtifact(projectPath);
  if (!artifact) return null;

  return artifact.data.tasks.every((task) => task.status === "done")
    ? "implemented"
    : "implementing";
}

export function getProjectState(projectPath: string): ProjectState {
  const brief = loadBriefArtifact(projectPath) !== null;
  const prds = listMarkdown(CairnDir.prdsDir(projectPath));
  const issues = listMarkdown(CairnDir.issuesDir(projectPath));

  let phase: ProjectPhase;
  if (!brief) phase = "scoping";
  else if (prds.length === 0) phase = "scoped";
  else if (issues.length === 0) phase = "slicing-prd-done";
  else phase = deriveTasksPhase(projectPath) ?? "sliced";

  return { brief, prds, issues, phase };
}
