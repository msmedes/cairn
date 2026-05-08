import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { CairnDir } from "./cairn-dir";

export type LegacyMigrationResult = {
  migrated: boolean;
};

export type LegacyMigrationOptions = {
  projectsRoot?: string;
};

function defaultProjectsRoot() {
  return join(homedir(), ".cairn", "projects");
}

function isDirectLegacyProject(projectPath: string, projectsRoot: string) {
  return resolve(dirname(projectPath)) === resolve(projectsRoot);
}

function moveFileIfPresent(projectPath: string, from: string, to: string) {
  const source = join(projectPath, from);
  if (!existsSync(source) || existsSync(to)) return;
  const parent = dirname(to);
  mkdirSync(parent, { recursive: true });
  renameSync(source, to);
}

function moveDirectoryIfPresent(projectPath: string, from: string, to: string) {
  const source = join(projectPath, from);
  if (!existsSync(source)) return;
  if (!existsSync(to)) {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(source, to);
    return;
  }

  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(source)) {
    const target = join(to, entry);
    if (existsSync(target)) continue;
    renameSync(join(source, entry), target);
  }
  if (readdirSync(source).length === 0) {
    rmSync(source, { recursive: true, force: true });
  }
}

export function migrateLegacyProject(
  projectPath: string,
  options: LegacyMigrationOptions = {},
): LegacyMigrationResult {
  const projectsRoot = options.projectsRoot ?? defaultProjectsRoot();
  const legacyMetadataPath = join(projectPath, "project.json");

  if (
    !isDirectLegacyProject(projectPath, projectsRoot) ||
    !existsSync(legacyMetadataPath) ||
    existsSync(CairnDir.metadataPath(projectPath))
  ) {
    return { migrated: false };
  }

  CairnDir.ensure(projectPath);

  for (const directory of ["sessions", "prds", "issues", "plans"]) {
    moveDirectoryIfPresent(
      projectPath,
      directory,
      join(CairnDir.root(projectPath), directory),
    );
  }

  for (const file of [
    "project.json",
    "brief.json",
    "brief.html",
    "plan.json",
    "plan.html",
    "tasks.json",
    "tasks.html",
    "CONTEXT.md",
    "project-context.json",
  ]) {
    moveFileIfPresent(
      projectPath,
      file,
      join(CairnDir.root(projectPath), basename(file)),
    );
  }

  return { migrated: true };
}
