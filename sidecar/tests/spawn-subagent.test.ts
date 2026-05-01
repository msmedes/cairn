import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSyntheticSourceInfo,
  type Skill,
} from "@mariozechner/pi-coding-agent";
import {
  buildSpawnSubagentSystemPrompt,
  mapSubAgentResult,
  type PiSubAgentResult,
  type SpawnSubagentResponseSchema,
  type SpawnSubagentResult,
  spawnSubagent,
} from "../spawn-subagent";

function tempProjectRoot() {
  return mkdtempSync(join(tmpdir(), "guide-spawn-subagent-"));
}

function writeSkill(projectRoot: string, name: string, body = "Do the work.") {
  const dir = join(projectRoot, "skills", name);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "SKILL.md");
  writeFileSync(
    filePath,
    `---\nname: ${name}\ndescription: Test skill\n---\n\n${body}`,
    "utf8",
  );
  return {
    name,
    description: "Test skill",
    filePath,
    baseDir: dir,
    sourceInfo: createSyntheticSourceInfo(filePath, {
      source: "test",
      baseDir: dir,
    }),
    disableModelInvocation: false,
  } satisfies Skill;
}

const cases: Array<{
  schema: SpawnSubagentResponseSchema;
  successText: string;
  success: SpawnSubagentResult;
  failureText: string;
  failure: SpawnSubagentResult;
  blockedText: string;
  blocked: SpawnSubagentResult;
  malformed: SpawnSubagentResult;
}> = [
  {
    schema: "task_outcome",
    successText: JSON.stringify({ outcome: "complete", message: "Done." }),
    success: { outcome: "complete", message: "Done." },
    failureText: JSON.stringify({ outcome: "failure", message: "Nope." }),
    failure: { outcome: "failure", message: "Nope." },
    blockedText: JSON.stringify({ outcome: "blocked", message: "Need input." }),
    blocked: { outcome: "blocked", message: "Need input." },
    malformed: {
      outcome: "failure",
      message: "sub-agent returned a malformed result",
    },
  },
  {
    schema: "verify_result",
    successText: JSON.stringify({ ok: true, message: "Build passed." }),
    success: { ok: true, message: "Build passed." },
    failureText: JSON.stringify({ ok: false, message: "Build failed." }),
    failure: { ok: false, message: "Build failed." },
    blockedText: JSON.stringify({ outcome: "blocked", message: "Need input." }),
    blocked: { ok: false, message: "Need input." },
    malformed: {
      ok: false,
      message: "sub-agent returned a malformed result",
    },
  },
  {
    schema: "artifact_write",
    successText: JSON.stringify({
      outcome: "complete",
      message: "Wrote it.",
      path: "brief.html",
    }),
    success: {
      outcome: "complete",
      message: "Wrote it.",
      path: "brief.html",
    },
    failureText: JSON.stringify({
      outcome: "failure",
      message: "Could not write.",
      path: "",
    }),
    failure: { outcome: "failure", message: "Could not write.", path: "" },
    blockedText: JSON.stringify({
      outcome: "blocked",
      message: "Need input.",
      path: "",
    }),
    blocked: { outcome: "blocked", message: "Need input.", path: "" },
    malformed: {
      outcome: "failure",
      message: "sub-agent returned a malformed result",
      path: "",
    },
  },
];

test.each(
  cases,
)("maps %s schema success, failure, blocked, and malformed paths", ({
  schema,
  successText,
  success,
  failureText,
  failure,
  blockedText,
  blocked,
  malformed,
}) => {
  expect(
    mapSubAgentResult(
      { stopReason: "end_turn", finalText: successText },
      schema,
    ),
  ).toEqual(success);
  expect(
    mapSubAgentResult(
      { stopReason: "end_turn", finalText: failureText },
      schema,
    ),
  ).toEqual(failure);
  expect(
    mapSubAgentResult(
      { stopReason: "end_turn", finalText: blockedText },
      schema,
    ),
  ).toEqual(blocked);
  expect(
    mapSubAgentResult(
      { stopReason: "end_turn", finalText: "not json" },
      schema,
    ),
  ).toEqual(malformed);
});

test.each([
  [
    "task_outcome",
    { outcome: "failure", message: "provider exploded" },
    { outcome: "blocked", message: "Task was cancelled." },
  ],
  [
    "verify_result",
    { ok: false, message: "provider exploded" },
    { ok: false, message: "Task was cancelled." },
  ],
  [
    "artifact_write",
    { outcome: "failure", message: "provider exploded", path: "" },
    { outcome: "failure", message: "Task was cancelled.", path: "" },
  ],
] as const)("normalizes %s terminal failures", (schema, errored, aborted) => {
  expect(
    mapSubAgentResult(
      {
        stopReason: "error",
        errorMessage: "provider exploded",
      } satisfies PiSubAgentResult,
      schema,
    ),
  ).toEqual(errored);
  expect(mapSubAgentResult({ stopReason: "aborted" }, schema)).toEqual(aborted);
});

test("spawnSubagent reports a missing skill as blocked without launching", async () => {
  const result = await spawnSubagent({
    projectRoot: tempProjectRoot(),
    skillName: "write-brief",
    args: {},
    responseSchema: "task_outcome",
    loadedSkills: [],
    runSubAgent: async () => {
      throw new Error("should not launch");
    },
  });

  expect(result).toEqual({
    outcome: "blocked",
    message: "skill write-brief not found",
  });
});

test("spawnSubagent gates recursion depth before launching", async () => {
  const projectRoot = tempProjectRoot();
  const skill = writeSkill(projectRoot, "write-prd");

  const result = await spawnSubagent({
    projectRoot,
    skillName: "write-prd",
    args: {},
    responseSchema: "task_outcome",
    loadedSkills: [skill],
    env: { GUIDE_SUBAGENT_DEPTH: "2" },
    runSubAgent: async () => {
      throw new Error("should not launch");
    },
  });

  expect(result).toEqual({
    outcome: "blocked",
    message: "recursion depth limit reached",
  });
});

test("spawnSubagent maps runner rejections to the requested failure shape", async () => {
  const projectRoot = tempProjectRoot();
  const skill = writeSkill(projectRoot, "write-prd");

  const result = await spawnSubagent({
    projectRoot,
    skillName: "write-prd",
    args: {},
    responseSchema: "artifact_write",
    loadedSkills: [skill],
    runSubAgent: async () => {
      throw new Error("provider unavailable");
    },
  });

  expect(result).toEqual({
    outcome: "failure",
    message: "provider unavailable",
    path: "",
  });
});

test("spawnSubagent maps unreadable skill files to the requested failure shape", async () => {
  const projectRoot = tempProjectRoot();
  const skill = writeSkill(projectRoot, "write-prd");
  skill.filePath = join(projectRoot, "missing", "SKILL.md");

  const result = await spawnSubagent({
    projectRoot,
    skillName: "write-prd",
    args: {},
    responseSchema: "verify_result",
    loadedSkills: [skill],
    runSubAgent: async () => {
      throw new Error("should not launch without skill content");
    },
  });

  expect(result).toEqual({
    ok: false,
    message: expect.stringContaining("SKILL.md"),
  });
});

test("spawnSubagent composes the skill prompt, serializes args, and increments depth", async () => {
  const projectRoot = tempProjectRoot();
  const skill = writeSkill(projectRoot, "write-prd", "Write the PRD.");
  const launches: Array<{
    prompt: string;
    systemPrompt: string;
    env: NodeJS.ProcessEnv;
  }> = [];

  const result = await spawnSubagent({
    projectRoot,
    skillName: "write-prd",
    args: { title: "First slice" },
    responseSchema: "artifact_write",
    loadedSkills: [skill],
    env: { GUIDE_SUBAGENT_DEPTH: "1" },
    runSubAgent: async ({ prompt, systemPrompt, env }) => {
      launches.push({ prompt, systemPrompt, env });
      return {
        stopReason: "end_turn",
        finalText: JSON.stringify({
          outcome: "complete",
          message: "Wrote it.",
          path: "prds/first.md",
        }),
      };
    },
  });

  expect(result).toEqual({
    outcome: "complete",
    message: "Wrote it.",
    path: "prds/first.md",
  });
  expect(launches).toHaveLength(1);
  expect(launches[0].prompt).toBe('{"title":"First slice"}');
  expect(launches[0].systemPrompt).toContain("Write the PRD.");
  expect(launches[0].systemPrompt).toContain("artifact_write");
  expect(launches[0].systemPrompt).toContain(
    "return only one JSON object matching this exact shape",
  );
  expect(launches[0].env.GUIDE_SUBAGENT_DEPTH).toBe("2");
});

test("buildSpawnSubagentSystemPrompt names every response shape", () => {
  expect(
    buildSpawnSubagentSystemPrompt("Skill body", "task_outcome"),
  ).toContain('"outcome": "complete" | "failure" | "blocked"');
  expect(
    buildSpawnSubagentSystemPrompt("Skill body", "verify_result"),
  ).toContain('"ok": boolean');
  expect(
    buildSpawnSubagentSystemPrompt("Skill body", "artifact_write"),
  ).toContain('"path": string');
});
