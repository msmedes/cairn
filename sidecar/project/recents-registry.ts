import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CairnDir } from "./cairn-dir";

export type RecentProjectEntry = {
  path: string;
  displayName: string;
  lastOpenedAt: string;
};

export type RecentsRegistryOptions = {
  homeDir?: string;
  registryPath?: string;
  projectsRoot?: string;
};

type ProjectMetadata = {
  name?: string;
  displayName?: string;
  lastOpenedAt?: string;
};

function defaultCairnRoot(homeDir = homedir()) {
  return join(homeDir, ".cairn");
}

function defaultProjectsRoot(homeDir = homedir()) {
  return join(defaultCairnRoot(homeDir), "projects");
}

function normalizeProjectPath(projectPath: string) {
  return resolve(projectPath);
}

function parseEntries(value: unknown): RecentProjectEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.path !== "string" ||
      typeof candidate.displayName !== "string" ||
      typeof candidate.lastOpenedAt !== "string"
    ) {
      return [];
    }
    return [
      {
        path: normalizeProjectPath(candidate.path),
        displayName: candidate.displayName,
        lastOpenedAt: candidate.lastOpenedAt,
      },
    ];
  });
}

function readMetadata(path: string): ProjectMetadata | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ProjectMetadata;
  } catch {
    return null;
  }
}

function metadataForProject(projectPath: string): ProjectMetadata | null {
  return (
    readMetadata(CairnDir.metadataPath(projectPath)) ??
    readMetadata(join(projectPath, "project.json"))
  );
}

function displayNameFor(projectPath: string, metadata: ProjectMetadata | null) {
  return (
    metadata?.displayName?.trim() ||
    metadata?.name?.trim() ||
    projectPath.split(/[\\/]/).filter(Boolean).at(-1) ||
    projectPath
  );
}

function lastOpenedAtFor(metadata: ProjectMetadata | null) {
  return metadata?.lastOpenedAt?.trim() || new Date(0).toISOString();
}

export class RecentsRegistry {
  private readonly registryPath: string;
  private readonly projectsRoot: string;

  constructor(options: RecentsRegistryOptions = {}) {
    const homeDir = options.homeDir ?? homedir();
    this.registryPath =
      options.registryPath ?? join(defaultCairnRoot(homeDir), "recents.json");
    this.projectsRoot = options.projectsRoot ?? defaultProjectsRoot(homeDir);
  }

  add(
    projectPath: string,
    displayName: string,
    now: Date = new Date(),
  ): RecentProjectEntry {
    const normalizedPath = normalizeProjectPath(projectPath);
    const entries = this.readEntries().filter(
      (entry) => entry.path !== normalizedPath,
    );
    const entry = {
      path: normalizedPath,
      displayName,
      lastOpenedAt: now.toISOString(),
    };
    this.writeEntries([entry, ...entries]);
    return entry;
  }

  list(): RecentProjectEntry[] {
    return this.readEntries().sort((a, b) => {
      const byTime = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
      if (byTime !== 0) return byTime;
      return a.path.localeCompare(b.path);
    });
  }

  findMostRecent(): RecentProjectEntry | null {
    return this.list()[0] ?? null;
  }

  remove(projectPath: string): void {
    const normalizedPath = normalizeProjectPath(projectPath);
    this.writeEntries(
      this.readEntries().filter((entry) => entry.path !== normalizedPath),
    );
  }

  bootstrapFromLegacyProjects(): void {
    if (existsSync(this.registryPath)) return;

    const entries: RecentProjectEntry[] = [];
    try {
      for (const name of readdirSync(this.projectsRoot)) {
        const projectPath = join(this.projectsRoot, name);
        if (!statSync(projectPath).isDirectory()) continue;
        if (
          !existsSync(join(projectPath, "project.json")) &&
          !existsSync(CairnDir.metadataPath(projectPath))
        ) {
          continue;
        }
        const metadata = metadataForProject(projectPath);
        entries.push({
          path: normalizeProjectPath(projectPath),
          displayName: displayNameFor(projectPath, metadata),
          lastOpenedAt: lastOpenedAtFor(metadata),
        });
      }
    } catch {
      // No legacy root yet; write an empty registry so bootstrap remains one-shot.
    }

    this.writeEntries(entries);
  }

  private readEntries(): RecentProjectEntry[] {
    try {
      return parseEntries(JSON.parse(readFileSync(this.registryPath, "utf8")));
    } catch {
      return [];
    }
  }

  private writeEntries(entries: RecentProjectEntry[]): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    writeFileSync(
      this.registryPath,
      `${JSON.stringify(this.sortedUnique(entries), null, 2)}\n`,
      "utf8",
    );
  }

  private sortedUnique(entries: RecentProjectEntry[]) {
    const byPath = new Map<string, RecentProjectEntry>();
    for (const entry of entries) {
      const normalizedPath = normalizeProjectPath(entry.path);
      const existing = byPath.get(normalizedPath);
      if (
        !existing ||
        Date.parse(entry.lastOpenedAt) >= Date.parse(existing.lastOpenedAt)
      ) {
        byPath.set(normalizedPath, { ...entry, path: normalizedPath });
      }
    }
    return [...byPath.values()].sort((a, b) => {
      const byTime = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
      if (byTime !== 0) return byTime;
      return a.path.localeCompare(b.path);
    });
  }
}
