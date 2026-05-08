import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CAIRN_DIR_NAME = ".cairn";
export const CAIRN_DIR_GITIGNORE = "*\n";

function root(projectPath: string) {
  return join(projectPath, CAIRN_DIR_NAME);
}

export const CairnDir = {
  root,

  ensure(projectPath: string) {
    const dir = root(projectPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), CAIRN_DIR_GITIGNORE, "utf8");
  },

  sessionsDir(projectPath: string) {
    return join(root(projectPath), "sessions");
  },

  briefPath(projectPath: string) {
    return join(root(projectPath), "brief.json");
  },

  planPath(projectPath: string) {
    return join(root(projectPath), "plan.json");
  },

  prdsDir(projectPath: string) {
    return join(root(projectPath), "prds");
  },

  issuesDir(projectPath: string) {
    return join(root(projectPath), "issues");
  },

  plansDir(projectPath: string) {
    return join(root(projectPath), "plans");
  },

  tasksPath(projectPath: string) {
    return join(root(projectPath), "tasks.json");
  },

  projectContextPath(projectPath: string) {
    return join(root(projectPath), "CONTEXT.md");
  },

  metadataPath(projectPath: string) {
    return join(root(projectPath), "project.json");
  },
};
