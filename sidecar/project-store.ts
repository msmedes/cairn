import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CairnDir } from "./cairn-dir";
import { migrateLegacyProject } from "./legacy-migrator";
import { slugify, withDatePrefix } from "./slug";

export type ProjectJson = {
  id: string;
  name: string;
  displayName?: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type Project = ProjectJson & {
  path: string;
  displayName: string;
};

export type ProjectRenameResult =
  | { ok: true; project: Project; message: string }
  | { ok: false; project: Project | null; message: string };

function cleanDisplayName(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (
    !compact ||
    (slugify(compact) === "untitled" && !/[\p{L}\p{N}]/u.test(compact))
  ) {
    return "Untitled";
  }
  return compact.slice(0, 80).trimEnd();
}

function isBlankDisplayName(input: string): boolean {
  const compact = input.replace(/\s+/g, " ").trim();
  return !compact;
}

function parseProjectJson(value: unknown): ProjectJson | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.lastOpenedAt !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    displayName:
      typeof candidate.displayName === "string"
        ? candidate.displayName
        : undefined,
    createdAt: candidate.createdAt,
    lastOpenedAt: candidate.lastOpenedAt,
  };
}

function isSafeProjectId(id: string): boolean {
  return id === slugify(id, { maxLength: 160 });
}

export class ProjectStore {
  read(projectPath: string): Project | null {
    const path = resolve(projectPath);
    migrateLegacyProject(path);
    const jsonPath = CairnDir.metadataPath(path);
    if (!existsSync(jsonPath)) return null;

    const metadata = parseProjectJson(
      JSON.parse(readFileSync(jsonPath, "utf8")),
    );
    if (!metadata || !isSafeProjectId(metadata.id)) return null;

    return this.enrich(metadata, path);
  }

  create(
    projectPath: string,
    firstMessage: string,
    now: Date = new Date(),
  ): Project {
    const path = resolve(projectPath);
    const displayName = cleanDisplayName(firstMessage);
    const timestamp = now.toISOString();
    const metadata: ProjectJson = {
      id: withDatePrefix(slugify(firstMessage), now),
      name: displayName,
      displayName,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
    };

    this.writeProjectJson(path, metadata);
    return this.enrich(metadata, path);
  }

  touch(projectPath: string, now: Date = new Date()): Project {
    const project = this.read(projectPath);
    if (!project) {
      throw new Error(`project not found: ${projectPath}`);
    }

    const metadata: ProjectJson = {
      id: project.id,
      name: project.name,
      displayName: project.displayName,
      createdAt: project.createdAt,
      lastOpenedAt: now.toISOString(),
    };
    this.writeProjectJson(project.path, metadata);
    return this.enrich(metadata, project.path);
  }

  rename(projectPath: string, displayName: string): ProjectRenameResult {
    const project = this.read(projectPath);
    if (!project) {
      return {
        ok: false,
        project: null,
        message: "I could not find the current project to name it.",
      };
    }

    if (isBlankDisplayName(displayName)) {
      return {
        ok: false,
        project,
        message: "I need a real project name before I can save that.",
      };
    }

    const cleanedName = cleanDisplayName(displayName);
    if (cleanedName === project.displayName) {
      return {
        ok: true,
        project,
        message: `I'll call it ${project.displayName}.`,
      };
    }

    const metadata: ProjectJson = {
      id: project.id,
      name: cleanedName,
      displayName: cleanedName,
      createdAt: project.createdAt,
      lastOpenedAt: new Date().toISOString(),
    };

    try {
      this.writeProjectJson(project.path, metadata);
      return {
        ok: true,
        project: this.enrich(metadata, project.path),
        message: `I'll call it ${cleanedName}.`,
      };
    } catch {
      return {
        ok: false,
        project,
        message:
          "I could not rename the project just now, so I'll keep going with the current name.",
      };
    }
  }

  private enrich(metadata: ProjectJson, path: string): Project {
    const displayName = metadata.displayName || metadata.name || metadata.id;
    return {
      ...metadata,
      name: metadata.name || displayName,
      displayName,
      path,
    };
  }

  private writeProjectJson(path: string, metadata: ProjectJson) {
    CairnDir.ensure(path);
    writeFileSync(
      CairnDir.metadataPath(path),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  }
}
