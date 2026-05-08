import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

export type ProjectLocatorOptions = {
  homeDir?: string;
};

function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasCairnDir(path: string) {
  const cairnDir = join(path, ".cairn");
  return existsSync(cairnDir) && isDirectory(cairnDir);
}

export function findProjectRoot(
  startPath: string,
  options: ProjectLocatorOptions = {},
): string | null {
  const home = resolve(options.homeDir ?? homedir());
  let current = resolve(startPath);
  const root = parse(current).root;

  if (!isDirectory(current)) return null;

  while (true) {
    if (hasCairnDir(current)) return current;
    if (current === home || current === root) return null;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export const ProjectLocator = {
  findProjectRoot,
};
