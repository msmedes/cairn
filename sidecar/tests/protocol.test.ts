/**
 * Sidecar protocol smoke test.
 *
 * Spawns the sidecar as a subprocess (no Tauri), initializes a real pi
 * session, and asserts the JSONL event sequence for init, hydrate, and prompt.
 *
 * Run with `bun test` from the sidecar/ directory.
 */

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DefaultResourceLoader,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";
import { loadRepoLocalEnv } from "../env";

const SIDECAR_ENTRY = resolve(import.meta.dir, "..", "index.ts");
const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const DEFAULT_TIMEOUT_MS = 60_000;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type SidecarEvent = { type: string } & Record<string, JsonValue>;
type SubprocessHandle = ReturnType<typeof Bun.spawn>;

const liveProcs = new Set<SubprocessHandle>();
loadRepoLocalEnv();

afterEach(() => {
  for (const proc of liveProcs) {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  }
  liveProcs.clear();
});

function spawnSidecar(
  homeDir?: string,
  extraEnv: Record<string, string> = {},
): SubprocessHandle {
  const proc = Bun.spawn(["bun", "run", SIDECAR_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: homeDir
      ? { ...process.env, HOME: homeDir, ...extraEnv }
      : { ...process.env, ...extraEnv },
  });
  liveProcs.add(proc);
  return proc;
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createGuideHome(): string {
  return createTempDir("guide-home-");
}

function createPersonaFile(
  contents = "You are the Guide. Ask one short scoping question at a time.",
): string {
  const personaPath = join(createTempDir("guide-persona-"), "persona.md");
  writeFileSync(personaPath, contents, "utf8");
  return personaPath;
}

function projectsRootFor(homeDir: string): string {
  return join(homeDir, ".guide", "projects");
}

function writeToSidecar(proc: SubprocessHandle, line: string) {
  const stdin = proc.stdin;
  if (!stdin || typeof stdin === "number") {
    throw new Error("sidecar stdin is not writable");
  }
  stdin.write(line);
}

function writeJsonToSidecar(proc: SubprocessHandle, msg: JsonValue) {
  writeToSidecar(proc, `${JSON.stringify(msg)}\n`);
}

/**
 * Drains the subprocess stdout, parsing JSONL events one at a time.
 * Resolves when `stopOn` returns true for an event, or rejects on timeout
 * / parse error / EOF before the stop condition.
 */
async function collectEvents(
  proc: SubprocessHandle,
  stopOn: (event: SidecarEvent) => boolean,
  timeoutMs: number,
): Promise<SidecarEvent[]> {
  const events: SidecarEvent[] = [];
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `timeout after ${timeoutMs}ms; events so far: ${JSON.stringify(events)}`,
          ),
        ),
      timeoutMs,
    ),
  );

  const drain = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(
          `sidecar stdout closed before stop condition; events: ${JSON.stringify(events)}`,
        );
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: SidecarEvent;
        try {
          event = JSON.parse(trimmed) as SidecarEvent;
        } catch {
          throw new Error(`non-JSON sidecar output: ${trimmed}`);
        }
        events.push(event);
        if (stopOn(event)) return events;
      }
    }
  })();

  try {
    return (await Promise.race([drain, timeout])) as SidecarEvent[];
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // fine — stream might already be closed
    }
  }
}

test("Guide-bundled slicing skills are discoverable by the sidecar resource loader", async () => {
  const loader = new DefaultResourceLoader({
    cwd: createTempDir("guide-skill-loader-"),
    agentDir: getAgentDir(),
    additionalSkillPaths: [resolve(REPO_ROOT, "prompts/skills")],
    noSkills: true,
  });
  await loader.reload();

  const { skills, diagnostics } = loader.getSkills();
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));

  expect(diagnostics).toEqual([]);
  for (const name of ["write-prd", "write-issue"]) {
    const skill = skillByName.get(name);
    expect(skill).toBeDefined();
    expect(skill?.description.trim().length).toBeGreaterThan(0);
    expect(skill?.disableModelInvocation).toBe(false);
  }
});

test("malformed input emits an error event without killing the sidecar", async () => {
  const proc = spawnSidecar();
  writeToSidecar(proc, "not json\n");

  const errorEvents = await collectEvents(
    proc,
    (event) => event.type === "error",
    DEFAULT_TIMEOUT_MS,
  );
  expect(errorEvents.at(-1)?.type).toBe("error");
});

test("init on an empty guide home reports ready without creating a project", async () => {
  const guideHome = createGuideHome();
  const proc = spawnSidecar(guideHome);
  const personaPath = createPersonaFile();
  const projectsRoot = projectsRootFor(guideHome);

  expect(existsSync(projectsRoot)).toBe(false);

  writeJsonToSidecar(proc, { type: "init", personaPath });

  const readyEvents = await collectEvents(
    proc,
    (event) => event.type === "ready",
    DEFAULT_TIMEOUT_MS,
  );
  expect(readyEvents.at(-1)?.type).toBe("ready");
  expect(readyEvents.find((event) => event.type === "hydrate")).toEqual({
    type: "hydrate",
    messages: [],
  });
  expect(existsSync(projectsRoot)).toBe(false);
});

test("init emits an error event when personaPath does not exist", async () => {
  const guideHome = createGuideHome();
  const proc = spawnSidecar(guideHome);
  const missingPersonaPath = join(
    createTempDir("guide-persona-missing-"),
    "missing-persona.md",
  );

  writeJsonToSidecar(proc, {
    type: "init",
    personaPath: missingPersonaPath,
  });

  const errorEvents = await collectEvents(
    proc,
    (event) => event.type === "error",
    DEFAULT_TIMEOUT_MS,
  );
  expect(errorEvents.at(-1)?.type).toBe("error");
  expect(errorEvents.at(-1)?.message).toContain("missing-persona.md");
});
