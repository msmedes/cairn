import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { disambiguate, slugify, withDatePrefix } from "./slug";

export type ProjectJson = {
  id: string;
  name: string;
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

function defaultProjectsRoot() {
  return join(homedir(), ".guide", "projects");
}

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
    createdAt: candidate.createdAt,
    lastOpenedAt: candidate.lastOpenedAt,
  };
}

function isSafeProjectId(id: string): boolean {
  return id === slugify(id, { maxLength: 160 });
}

export class ProjectStore {
  constructor(private readonly projectsRoot = defaultProjectsRoot()) {}

  list(): Project[] {
    if (!existsSync(this.projectsRoot)) return [];

    return readdirSync(this.projectsRoot)
      .flatMap((name) => {
        const path = join(this.projectsRoot, name);
        try {
          if (!statSync(path).isDirectory()) return [];
          const project = this.read(name);
          return project ? [project] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  findMostRecent(): Project | null {
    return (
      this.list().sort((a, b) => {
        const byLastOpened =
          Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
        if (byLastOpened !== 0) return byLastOpened;
        return b.id.localeCompare(a.id);
      })[0] ?? null
    );
  }

  create(firstMessage: string, now: Date = new Date()): Project {
    mkdirSync(this.projectsRoot, { recursive: true });
    const baseSlug = withDatePrefix(slugify(firstMessage), now);
    const id = disambiguate(baseSlug, this.existingProjectIds());
    const path = join(this.projectsRoot, id);
    const timestamp = now.toISOString();
    const metadata: ProjectJson = {
      id,
      name: cleanDisplayName(firstMessage),
      createdAt: timestamp,
      lastOpenedAt: timestamp,
    };

    mkdirSync(path, { recursive: false });
    mkdirSync(join(path, "sessions"), { recursive: true });
    this.writeProjectJson(path, metadata);
    return this.enrich(metadata);
  }

  read(id: string): Project | null {
    if (!isSafeProjectId(id)) return null;
    const path = join(this.projectsRoot, id);
    const jsonPath = join(path, "project.json");
    if (!existsSync(jsonPath)) return null;

    const metadata = parseProjectJson(
      JSON.parse(readFileSync(jsonPath, "utf8")),
    );
    if (!metadata) return null;
    if (metadata.id !== id || !isSafeProjectId(metadata.id)) return null;

    return this.enrich(metadata, path);
  }

  touch(id: string, now: Date = new Date()): Project {
    const project = this.read(id);
    if (!project) {
      throw new Error(`project not found: ${id}`);
    }

    const metadata: ProjectJson = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      lastOpenedAt: now.toISOString(),
    };
    this.writeProjectJson(project.path, metadata);
    return this.enrich(metadata, project.path);
  }

  rename(id: string, displayName: string): ProjectRenameResult {
    // Renaming updates displayName in metadata only. The on-disk directory
    // and project id stay fixed at their create-time slug so any path the
    // running agent has already learned (artifact absolute paths, the
    // project root passed into skills) remains valid for the rest of the
    // session. Without this, a rename mid-session would orphan subsequent
    // writes into a phantom directory recreated at the old path.
    const project = this.read(id);
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
    if (cleanedName === project.name) {
      return {
        ok: true,
        project,
        message: `I'll call it ${project.displayName}.`,
      };
    }

    const metadata: ProjectJson = {
      id: project.id,
      name: cleanedName,
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

  private existingProjectIds(): string[] {
    if (!existsSync(this.projectsRoot)) return [];
    return readdirSync(this.projectsRoot).flatMap((name) => {
      try {
        return statSync(join(this.projectsRoot, name)).isDirectory()
          ? [name]
          : [];
      } catch {
        return [];
      }
    });
  }

  private enrich(
    metadata: ProjectJson,
    path = join(this.projectsRoot, metadata.id),
  ): Project {
    return {
      ...metadata,
      path,
      displayName: metadata.name || metadata.id,
    };
  }

  private writeProjectJson(path: string, metadata: ProjectJson) {
    writeFileSync(
      join(path, "project.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  }
}
