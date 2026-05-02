import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStartTaskPrompt,
  mapSubAgentResult,
  type PiSubAgentResult,
  startTask,
} from "../start-task";

function tempProjectRoot() {
  return mkdtempSync(join(tmpdir(), "cairn-start-task-"));
}

test.each([
  [
    "complete",
    {
      stopReason: "end_turn",
      finalText: JSON.stringify({
        outcome: "complete",
        message: "Implemented with tests passing.",
      }),
    },
    { outcome: "complete", message: "Implemented with tests passing." },
  ],
  [
    "failure",
    {
      stopReason: "error",
      errorMessage: "Tests failed after implementation.",
      finalText: "",
    },
    { outcome: "failure", message: "Tests failed after implementation." },
  ],
  [
    "blocked",
    {
      stopReason: "end_turn",
      finalText: JSON.stringify({
        outcome: "blocked",
        message: "Need product input on the required data source.",
      }),
    },
    {
      outcome: "blocked",
      message: "Need product input on the required data source.",
    },
  ],
  [
    "fallback",
    {
      stopReason: "end_turn",
      finalText: "done I think",
    },
    {
      outcome: "failure",
      message: "The sub-agent ended without a recognized task outcome.",
    },
  ],
] as const)("maps pi sub-agent %s terminal result", (_name, nativeResult, expected) => {
  expect(mapSubAgentResult(nativeResult satisfies PiSubAgentResult)).toEqual(
    expected,
  );
});

test("start_task handoff prompt includes the issue file, source PRD, and fixed TDD instruction", () => {
  const prompt = buildStartTaskPrompt({
    issuePath: "issues/06-2-start-task.md",
    issueMarkdown: "## Source\n\n`prds/06-implementing.md`\n\n## Work",
    prdPath: "prds/06-implementing.md",
    prdMarkdown: "# PRD",
  });

  expect(prompt).toContain("issues/06-2-start-task.md");
  expect(prompt).toContain("prds/06-implementing.md");
  expect(prompt).toContain("red-green TDD");
  expect(prompt).toContain('"outcome": "complete" | "failure" | "blocked"');
});

test("startTask loads the issue and source PRD before dispatching a pi sub-agent", async () => {
  const projectRoot = tempProjectRoot();
  mkdirSync(join(projectRoot, "issues"));
  mkdirSync(join(projectRoot, "prds"));
  writeFileSync(
    join(projectRoot, "issues", "06-2-start-task.md"),
    "## Source\n\n`prds/06-implementing.md`\n\n## Work\nBuild it.",
  );
  writeFileSync(join(projectRoot, "prds", "06-implementing.md"), "# PRD");

  const prompts: string[] = [];
  const result = await startTask({
    projectRoot,
    issuePath: "issues/06-2-start-task.md",
    runSubAgent: async ({ cwd, prompt }) => {
      expect(cwd).toBe(projectRoot);
      prompts.push(prompt);
      return {
        stopReason: "end_turn",
        finalText: JSON.stringify({
          outcome: "complete",
          message: "Done.",
        }),
      };
    },
  });

  expect(result).toEqual({ outcome: "complete", message: "Done." });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Build it.");
  expect(prompts[0]).toContain("# PRD");
});

test("startTask reports invalid issue paths as blocked outcomes", async () => {
  for (const [issuePath, message] of [
    ["../outside.md", "start_task issuePath must stay inside the project."],
    ["/tmp/outside.md", "start_task issuePath must be project-relative."],
  ] as const) {
    const result = await startTask({
      projectRoot: tempProjectRoot(),
      issuePath,
      runSubAgent: async () => {
        throw new Error("should not dispatch invalid issue paths");
      },
    });

    expect(result).toEqual({ outcome: "blocked", message });
  }
});

test("startTask maps sub-agent runner rejections to failure outcomes", async () => {
  const projectRoot = tempProjectRoot();
  mkdirSync(join(projectRoot, "issues"));
  mkdirSync(join(projectRoot, "prds"));
  writeFileSync(
    join(projectRoot, "issues", "06-2-start-task.md"),
    "## Source\n\n`prds/06-implementing.md`\n\n## Work\nBuild it.",
  );
  writeFileSync(join(projectRoot, "prds", "06-implementing.md"), "# PRD");

  const result = await startTask({
    projectRoot,
    issuePath: "issues/06-2-start-task.md",
    runSubAgent: async () => {
      throw new Error("provider unavailable");
    },
  });

  expect(result).toEqual({
    outcome: "failure",
    message: "provider unavailable",
  });
});

test("non-success sub-agent stop reasons cannot map to complete", () => {
  expect(
    mapSubAgentResult({
      stopReason: "max_tokens",
      finalText: JSON.stringify({
        outcome: "complete",
        message: "Done.",
      }),
    }),
  ).toEqual({
    outcome: "failure",
    message: "The sub-agent stopped before producing a normal completion.",
  });
});
