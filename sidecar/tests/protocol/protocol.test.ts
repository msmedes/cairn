/**
 * Sidecar protocol smoke test.
 *
 * Spawns the sidecar as a subprocess (no Tauri), initializes a real pi
 * session, and asserts the JSONL event sequence for init, hydrate, and prompt.
 *
 * Run with `bun test` from the sidecar/ directory.
 */

import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DefaultResourceLoader,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";
import { loadRepoLocalEnv } from "../../config/env";
import { CairnDir } from "../../project/cairn-dir";

const SIDECAR_ENTRY = resolve(import.meta.dir, "..", "..", "index.ts");
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const DEFAULT_TIMEOUT_MS = 60_000;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type SidecarEvent = { type: string } & Record<string, JsonValue>;
type SessionEntryJson = {
  type?: string;
  message?: {
    role?: string;
    content?: JsonValue;
  };
};
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

function createCairnHome(): string {
  return createTempDir("cairn-home-");
}

function createPersonaFile(
  contents = "You are Cairn. Ask one short scoping question at a time.",
): string {
  const personaPath = join(createTempDir("cairn-persona-"), "persona.md");
  writeFileSync(personaPath, contents, "utf8");
  return personaPath;
}

function projectsRootFor(homeDir: string): string {
  return join(homeDir, ".cairn", "projects");
}

function createStoredProject(homeDir: string, id = "2026-04-30-test-project") {
  const projectPath = join(projectsRootFor(homeDir), id);
  mkdirSync(join(projectPath, "sessions"), { recursive: true });
  writeFileSync(
    join(projectPath, "project.json"),
    JSON.stringify({
      id,
      name: "Test Project",
      createdAt: "2026-04-30T12:00:00.000Z",
      lastOpenedAt: "2026-04-30T12:00:00.000Z",
    }),
    "utf8",
  );
  return projectPath;
}

function createCairnProjectAt(projectPath: string, id = "2026-05-08-project") {
  CairnDir.ensure(projectPath);
  mkdirSync(CairnDir.sessionsDir(projectPath), { recursive: true });
  writeFileSync(
    CairnDir.metadataPath(projectPath),
    JSON.stringify({
      id,
      name: "Located Project",
      displayName: "Located Project",
      createdAt: "2026-05-08T12:00:00.000Z",
      lastOpenedAt: "2026-05-08T12:00:00.000Z",
    }),
    "utf8",
  );
}

function kill(proc: SubprocessHandle) {
  try {
    proc.kill();
  } catch {
    // already dead
  }
  liveProcs.delete(proc);
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

test("Cairn-bundled slicing skills are discoverable by the sidecar resource loader", async () => {
  const loader = new DefaultResourceLoader({
    cwd: createTempDir("cairn-skill-loader-"),
    agentDir: getAgentDir(),
    additionalSkillPaths: [resolve(REPO_ROOT, "prompts/skills")],
    noSkills: true,
  });
  await loader.reload();

  const { skills, diagnostics } = loader.getSkills();
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));

  expect(diagnostics).toEqual([]);
  for (const name of [
    "write-brief",
    "write-plan",
    "write-tasks",
    "write-prd",
    "write-issue",
    "implement-issue",
    "review-issue",
    "verify-slice",
    "quality-code",
  ]) {
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

test("init on an empty cairn home reports ready without creating a project", async () => {
  const cairnHome = createCairnHome();
  const proc = spawnSidecar(cairnHome);
  const personaPath = createPersonaFile();
  const projectsRoot = projectsRootFor(cairnHome);

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

test(
  "open_project initializes a fresh directory, persists a prompt, and resumes through recents",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createTempDir("cairn-open-project-");
    const personaPath = createPersonaFile("You are Cairn.");
    const env = { CAIRN_FAKE_PROTOCOL_TEXT_RESPONSE: "I saved the session." };
    const proc = spawnSidecar(cairnHome, env);

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, { type: "open_project", path: projectPath });
    const openEvents = await collectEvents(
      proc,
      (event) => event.type === "active_project",
      DEFAULT_TIMEOUT_MS,
    );

    expect(
      readFileSync(join(projectPath, ".cairn", ".gitignore"), "utf8"),
    ).toBe("*\n");
    expect(openEvents.at(-1)?.project).toMatchObject({ path: projectPath });

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Start this project.",
    });
    const promptEvents = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );
    expect(existsSync(CairnDir.metadataPath(projectPath))).toBe(true);
    expect(
      JSON.parse(readFileSync(CairnDir.metadataPath(projectPath), "utf8")),
    ).toMatchObject({ displayName: "Untitled" });
    const promptRecentsEvent = promptEvents
      .filter(
        (
          event,
        ): event is SidecarEvent & { entries: Array<Record<string, string>> } =>
          event.type === "recents" && Array.isArray(event.entries),
      )
      .at(-1);
    expect(promptRecentsEvent?.entries[0]).toMatchObject({
      path: projectPath,
      displayName: "Untitled",
    });
    expect(
      readdirSync(CairnDir.sessionsDir(projectPath)).some((name) =>
        name.endsWith(".jsonl"),
      ),
    ).toBe(true);

    kill(proc);
    const restarted = spawnSidecar(cairnHome, env);
    writeJsonToSidecar(restarted, { type: "init", personaPath });
    const restartEvents = await collectEvents(
      restarted,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    expect(
      restartEvents.find((event) => event.type === "active_project")?.project,
    ).toMatchObject({ path: projectPath });
    const restartRecentsEvent = restartEvents
      .filter(
        (
          event,
        ): event is SidecarEvent & { entries: Array<Record<string, string>> } =>
          event.type === "recents" && Array.isArray(event.entries),
      )
      .at(-1);
    expect(restartRecentsEvent?.entries[0]).toMatchObject({
      path: projectPath,
      displayName: "Untitled",
    });
    const hydrateEvent = restartEvents.find(
      (event): event is SidecarEvent & { messages: Array<{ text: string }> } =>
        event.type === "hydrate" && Array.isArray(event.messages),
    );
    expect(
      hydrateEvent?.messages.some((message) =>
        message.text.includes("Start this project."),
      ),
    ).toBe(true);
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "prompt with images persists pi image content and rehydrates image-only messages",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createTempDir("cairn-image-prompt-");
    const personaPath = createPersonaFile("You are Cairn.");
    const env = { CAIRN_FAKE_PROTOCOL_TEXT_RESPONSE: "I can see it." };
    const proc = spawnSidecar(cairnHome, env);

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );
    writeJsonToSidecar(proc, { type: "open_project", path: projectPath });
    await collectEvents(
      proc,
      (event) => event.type === "active_project",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "",
      images: [{ data: "AQID", mimeType: "image/png" }],
    });
    await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const sessionFile = readdirSync(CairnDir.sessionsDir(projectPath))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(CairnDir.sessionsDir(projectPath), name))
      .at(0);
    expect(sessionFile).toBeDefined();
    const sessionEntries = readFileSync(sessionFile ?? "", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SessionEntryJson);
    const userEntry = sessionEntries.find(
      (entry) => entry.type === "message" && entry.message?.role === "user",
    );
    expect(userEntry?.message?.content).toEqual([
      { type: "text", text: "" },
      { type: "image", data: "AQID", mimeType: "image/png" },
    ]);

    kill(proc);
    const restarted = spawnSidecar(cairnHome, env);
    writeJsonToSidecar(restarted, { type: "init", personaPath });
    const restartEvents = await collectEvents(
      restarted,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );
    const hydrateEvent = restartEvents.find(
      (
        event,
      ): event is SidecarEvent & {
        messages: Array<{
          text: string;
          images?: Array<{ dataUrl: string; mimeType: string }>;
        }>;
      } => event.type === "hydrate" && Array.isArray(event.messages),
    );
    expect(hydrateEvent?.messages[0]).toMatchObject({
      text: "",
      images: [
        { dataUrl: "data:image/png;base64,AQID", mimeType: "image/png" },
      ],
    });
  },
  DEFAULT_TIMEOUT_MS,
);

test("open_project migrates a legacy-shaped project before opening it", async () => {
  const cairnHome = createCairnHome();
  const legacyPath = createStoredProject(cairnHome, "2026-05-01-legacy");
  const proc = spawnSidecar(cairnHome);
  const personaPath = createPersonaFile("You are Cairn.");

  writeJsonToSidecar(proc, { type: "init", personaPath });
  await collectEvents(
    proc,
    (event) => event.type === "ready",
    DEFAULT_TIMEOUT_MS,
  );

  writeJsonToSidecar(proc, { type: "open_project", path: legacyPath });
  await collectEvents(
    proc,
    (event) => event.type === "active_project",
    DEFAULT_TIMEOUT_MS,
  );

  expect(existsSync(CairnDir.metadataPath(legacyPath))).toBe(true);
  expect(existsSync(join(legacyPath, "project.json"))).toBe(false);
});

test("startup-style open_project locates the nearest project root from a subdirectory", async () => {
  const cairnHome = createCairnHome();
  const projectPath = createTempDir("cairn-located-project-");
  const subdir = join(projectPath, "src", "nested");
  mkdirSync(subdir, { recursive: true });
  createCairnProjectAt(projectPath);
  const proc = spawnSidecar(cairnHome);
  const personaPath = createPersonaFile("You are Cairn.");

  writeJsonToSidecar(proc, { type: "init", personaPath });
  await collectEvents(
    proc,
    (event) => event.type === "ready",
    DEFAULT_TIMEOUT_MS,
  );

  writeJsonToSidecar(proc, {
    type: "open_project",
    path: subdir,
    locateProjectRoot: true,
  });
  const events = await collectEvents(
    proc,
    (event) => event.type === "active_project",
    DEFAULT_TIMEOUT_MS,
  );

  expect(events.at(-1)?.project).toMatchObject({ path: projectPath });
  expect(existsSync(join(subdir, ".cairn"))).toBe(false);
});

test("open_project failure prunes the stale recent and remains recoverable", async () => {
  const cairnHome = createCairnHome();
  const missingPath = join(createTempDir("cairn-missing-parent-"), "missing");
  const proc = spawnSidecar(cairnHome);
  const personaPath = createPersonaFile("You are Cairn.");

  writeJsonToSidecar(proc, { type: "init", personaPath });
  await collectEvents(
    proc,
    (event) => event.type === "ready",
    DEFAULT_TIMEOUT_MS,
  );

  writeJsonToSidecar(proc, { type: "open_project", path: missingPath });
  const failureEvents = await collectEvents(
    proc,
    (event) => event.type === "error",
    DEFAULT_TIMEOUT_MS,
  );

  expect(failureEvents.at(-1)).toMatchObject({
    type: "error",
    recoverable: true,
  });

  writeJsonToSidecar(proc, { type: "list_recents" });
  const recentsEvents = await collectEvents(
    proc,
    (event) => event.type === "recents",
    DEFAULT_TIMEOUT_MS,
  );
  expect(recentsEvents.at(-1)).toMatchObject({
    type: "recents",
    entries: [],
  });
});

test(
  "set_project_name updates the recents display name",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createTempDir("cairn-rename-recent-");
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_SET_PROJECT_NAME: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, { type: "open_project", path: projectPath });
    await collectEvents(
      proc,
      (event) => event.type === "active_project",
      DEFAULT_TIMEOUT_MS,
    );
    writeJsonToSidecar(proc, { type: "prompt", text: "Name this project." });

    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const recentsEvent = events
      .filter(
        (
          event,
        ): event is SidecarEvent & { entries: Array<Record<string, string>> } =>
          event.type === "recents" && Array.isArray(event.entries),
      )
      .at(-1);
    expect(recentsEvent?.entries[0]).toMatchObject({
      path: projectPath,
      displayName: "Renamed Project",
    });
  },
  DEFAULT_TIMEOUT_MS,
);

test("init emits an error event when personaPath does not exist", async () => {
  const cairnHome = createCairnHome();
  const proc = spawnSidecar(cairnHome);
  const missingPersonaPath = join(
    createTempDir("cairn-persona-missing-"),
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

test(
  "spawn_subagent fake result flows through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_SPAWN_SUBAGENT: "1",
      CAIRN_FAKE_SPAWN_SUBAGENT_RESULT: JSON.stringify({
        outcome: "blocked",
        message: "Need product input.",
      }),
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Start the first slice.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain(
      'spawn_subagent result: {"outcome":"blocked","message":"Need product input."}',
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "ask_user_question parks, emits a question bundle, and resumes from an out-of-band answer",
  async () => {
    const cairnHome = createCairnHome();
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_ASK_USER_QUESTION: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Ask me grouped questions.",
    });
    const questionEvents = await collectEvents(
      proc,
      (event) => event.type === "ask_user_question",
      DEFAULT_TIMEOUT_MS,
    );
    const questionEvent = questionEvents.at(-1);
    expect(questionEvent).toMatchObject({
      type: "ask_user_question",
      toolCallId: "tool-ask-user-question",
      questions: [
        {
          header: "Audience",
          question: "Who should this first version serve?",
        },
        {
          header: "Scope",
          question: "What should the first slice include?",
        },
      ],
    });

    writeJsonToSidecar(proc, {
      type: "answer_question",
      toolCallId: "tool-ask-user-question",
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          header: "Audience",
          question: "Who should this first version serve?",
          kind: "option",
          option: {
            label: "Team leads",
            description: "People who need lightweight training checks.",
          },
        },
        {
          questionIndex: 1,
          header: "Scope",
          question: "What should the first slice include?",
          kind: "option",
          option: {
            label: "One video",
            description: "Keep the first version focused on one upload.",
          },
        },
      ],
    });

    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );
    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain(
      'ask_user_question result: {"cancelled":false,"answers":[{"questionIndex":0',
    );
    expect(text).toContain('"label":"One video"');
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "update_task_status mutates tasks.json through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const tasksPath = CairnDir.tasksPath(projectPath);
    writeFileSync(
      join(projectPath, "tasks.json"),
      JSON.stringify({
        artifact: "tasks",
        schemaVersion: 1,
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:00:00.000Z",
        data: {
          tasks: [
            {
              slug: "create-the-first-quiz-draft",
              issuePath: "issues/01-create-the-first-quiz-draft.md",
              title: "Create the first quiz draft",
              status: "todo",
            },
            {
              slug: "preview-it-as-a-learner",
              issuePath: "issues/02-preview-it-as-a-learner.md",
              title: "Preview it as a learner",
              status: "todo",
            },
          ],
        },
      }),
      "utf8",
    );
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_UPDATE_TASK_STATUS: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Mark the second task done.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('update_task_status result: {"ok":true');
    expect(JSON.parse(readFileSync(tasksPath, "utf8"))).toMatchObject({
      data: {
        tasks: [
          { slug: "create-the-first-quiz-draft", status: "todo" },
          { slug: "preview-it-as-a-learner", status: "done" },
        ],
      },
    });
    expect(existsSync(join(CairnDir.root(projectPath), "tasks.html"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "create_tasks_artifact writes tasks.json through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const tasksPath = CairnDir.tasksPath(projectPath);
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_CREATE_TASKS: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Save the tasks.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('create_tasks_artifact result: {"ok":true');

    const parsed = JSON.parse(readFileSync(tasksPath, "utf8"));
    expect(parsed).toMatchObject({
      artifact: "tasks",
      schemaVersion: 1,
      data: {
        tasks: [
          {
            slug: "create-the-first-quiz-draft",
            issuePath: "issues/01-create-the-first-quiz-draft.md",
            title: "Create the first quiz draft",
            status: "todo",
          },
          {
            slug: "preview-it-as-a-learner",
            issuePath: "issues/02-preview-it-as-a-learner.md",
            title: "Preview it as a learner",
            status: "todo",
          },
        ],
      },
    });
    expect(existsSync(join(CairnDir.root(projectPath), "tasks.html"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "create_brief_artifact writes brief.json through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const briefPath = CairnDir.briefPath(projectPath);
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_CREATE_BRIEF: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Save the brief.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('create_brief_artifact result: {"ok":true');

    const parsed = JSON.parse(readFileSync(briefPath, "utf8"));
    expect(parsed).toMatchObject({
      artifact: "brief",
      schemaVersion: 1,
      data: {
        title: "Video Quiz Helper",
      },
    });
    expect(existsSync(join(CairnDir.root(projectPath), "brief.html"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "update_brief_artifact revises brief.json through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const briefPath = CairnDir.briefPath(projectPath);
    writeFileSync(
      join(projectPath, "brief.json"),
      JSON.stringify({
        artifact: "brief",
        schemaVersion: 1,
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:00:00.000Z",
        data: {
          title: "Video Quiz Helper",
          summary:
            "A small tool for turning training videos into simple quizzes.",
          audience: "Team leads who need lightweight training checks.",
          success:
            "A lead can paste in a video, add questions, and share the quiz.",
          sections: [
            {
              heading: "What it does first",
              body: "It helps a lead create one quiz from one training video.",
            },
          ],
        },
      }),
      "utf8",
    );
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_UPDATE_BRIEF: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Revise the brief.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('update_brief_artifact result: {"ok":true');

    const parsed = JSON.parse(readFileSync(briefPath, "utf8"));
    expect(parsed).toMatchObject({
      artifact: "brief",
      schemaVersion: 1,
      lastUpdateReason: "User narrowed the first version.",
      data: {
        title: "Focused Video Quiz Helper",
      },
    });
    expect(existsSync(join(CairnDir.root(projectPath), "brief.html"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "create_plan_artifact writes plan.json through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const planPath = CairnDir.planPath(projectPath);
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_CREATE_PLAN: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Save the plan.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('create_plan_artifact result: {"ok":true');

    const parsed = JSON.parse(readFileSync(planPath, "utf8"));
    expect(parsed).toMatchObject({
      artifact: "plan",
      schemaVersion: 1,
      data: {
        title: "First playable quiz",
      },
    });
    expect(existsSync(join(CairnDir.root(projectPath), "plan.html"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "update_plan_artifact revises plan.json through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const planPath = CairnDir.planPath(projectPath);
    writeFileSync(
      join(projectPath, "plan.json"),
      JSON.stringify({
        artifact: "plan",
        schemaVersion: 1,
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:00:00.000Z",
        data: {
          title: "First playable quiz",
          summary: "Start with one video and one shareable quiz.",
          fromBrief:
            "The brief asks for lightweight checks, so this proves one quiz end to end.",
          outcomes: ["You'll be able to paste in one training video."],
          pieces: [
            "Create the first quiz draft",
            "Preview it as a learner",
            "Share the finished quiz",
          ],
          notYet: ["Team analytics", "Question banks"],
        },
      }),
      "utf8",
    );
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_UPDATE_PLAN: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Revise the plan.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('update_plan_artifact result: {"ok":true');

    const parsed = JSON.parse(readFileSync(planPath, "utf8"));
    expect(parsed).toMatchObject({
      artifact: "plan",
      schemaVersion: 1,
      lastUpdateReason: "User changed the first slice.",
      data: {
        title: "Focused first quiz",
      },
    });
    expect(existsSync(join(CairnDir.root(projectPath), "plan.html"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);

test(
  "update_project_context writes CONTEXT.md through the sidecar protocol",
  async () => {
    const cairnHome = createCairnHome();
    const projectPath = createStoredProject(cairnHome);
    const contextPath = CairnDir.projectContextPath(projectPath);
    const proc = spawnSidecar(cairnHome, {
      CAIRN_FAKE_PROTOCOL_UPDATE_PROJECT_CONTEXT: "1",
    });
    const personaPath = createPersonaFile("You are Cairn.");

    writeJsonToSidecar(proc, { type: "init", personaPath });
    await collectEvents(
      proc,
      (event) => event.type === "ready",
      DEFAULT_TIMEOUT_MS,
    );

    writeJsonToSidecar(proc, {
      type: "prompt",
      text: "Remember this durable project context.",
    });
    const events = await collectEvents(
      proc,
      (event) => event.type === "agent_end",
      DEFAULT_TIMEOUT_MS,
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta)
      .join("");
    expect(text).toContain('update_project_context result: {"ok":true');

    const contextText = readFileSync(contextPath, "utf8");
    expect(contextText).toContain("**Instructor**:");
    expect(contextText).toContain("- Keep setup non-technical and app-owned.");
    expect(existsSync(join(CairnDir.root(projectPath), "context.json"))).toBe(
      false,
    );
  },
  DEFAULT_TIMEOUT_MS,
);
