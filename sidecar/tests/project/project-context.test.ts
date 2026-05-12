import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CairnDir } from "../../project/cairn-dir";
import {
  loadProjectContext,
  type ProjectContextUpdateInput,
  updateProjectContext,
} from "../../project/project-context";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "cairn-project-context-"));
}

function update(
  projectRoot: string,
  input: ProjectContextUpdateInput["updates"],
) {
  return updateProjectContext({
    projectRoot,
    updates: input,
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });
}

test("updateProjectContext creates canonical CONTEXT.md with durable project facts", () => {
  const projectRoot = tempProject();

  const result = update(projectRoot, {
    terms: [
      {
        name: "Instructor",
        definition: "The person creating lightweight checks for a team.",
      },
    ],
    constraints: ["Works without asking the user to manage files."],
    decisions: ["Start with one video and one quiz before adding analytics."],
    openQuestions: ["Should quizzes be shareable by link or export first?"],
  });

  expect(result).toEqual({
    ok: true,
    path: "CONTEXT.md",
    termCount: 1,
    constraintCount: 1,
    decisionCount: 1,
    openQuestionCount: 1,
  });
  expect(existsSync(CairnDir.projectContextPath(projectRoot))).toBe(true);
  expect(loadProjectContext(projectRoot)).toEqual({
    terms: [
      {
        name: "Instructor",
        definition: "The person creating lightweight checks for a team.",
      },
    ],
    constraints: ["Works without asking the user to manage files."],
    decisions: ["Start with one video and one quiz before adding analytics."],
    openQuestions: ["Should quizzes be shareable by link or export first?"],
  });
  const text = readFileSync(CairnDir.projectContextPath(projectRoot), "utf8");
  expect(text.match(/^## Language$/gm)).toHaveLength(1);
  expect(text.match(/^## Constraints$/gm)).toHaveLength(1);
  expect(text.match(/^## Decisions$/gm)).toHaveLength(1);
  expect(text.match(/^## Open Questions$/gm)).toHaveLength(1);
});

test("updateProjectContext does not promote empty placeholders into durable facts", () => {
  const projectRoot = tempProject();
  update(projectRoot, {
    terms: [{ name: "Instructor", definition: "The quiz creator." }],
  });

  const result = update(projectRoot, {
    constraints: ["Keep setup non-technical."],
  });

  expect(result).toEqual({
    ok: true,
    path: "CONTEXT.md",
    termCount: 1,
    constraintCount: 1,
    decisionCount: 0,
    openQuestionCount: 0,
  });
  expect(loadProjectContext(projectRoot)).toEqual({
    terms: [{ name: "Instructor", definition: "The quiz creator." }],
    constraints: ["Keep setup non-technical."],
    decisions: [],
    openQuestions: [],
  });
  expect(
    readFileSync(CairnDir.projectContextPath(projectRoot), "utf8"),
  ).not.toContain("- None yet.\n- Keep setup non-technical.");
});

test("updateProjectContext preserves existing section structure and avoids duplicate noise", () => {
  const projectRoot = tempProject();
  CairnDir.ensure(projectRoot);
  writeFileSync(
    CairnDir.projectContextPath(projectRoot),
    [
      "# Project Context",
      "",
      "## Language",
      "",
      "**Instructor**:",
      "Someone who gives training.",
      "",
      "## Constraints",
      "",
      "- Keep setup non-technical.",
      "",
      "## Decisions",
      "",
      "- Start with one video.",
      "",
      "## Open Questions",
      "",
      "- How should sharing work?",
      "",
      "## Notes",
      "",
      "This section is owned by a future workflow.",
      "",
    ].join("\n"),
    "utf8",
  );

  update(projectRoot, {
    terms: [
      {
        name: "Instructor",
        definition: "The team lead preparing a quiz.",
      },
      { name: "Learner", definition: "The person taking the quiz." },
    ],
    constraints: [
      "Keep setup non-technical.",
      "Do not expose engineering scaffolding in the panel.",
    ],
    decisions: ["Start with one video.", "Treat analytics as later work."],
    openQuestions: [
      "How should sharing work?",
      "Who reviews generated questions?",
    ],
  });

  const text = readFileSync(CairnDir.projectContextPath(projectRoot), "utf8");
  expect(text).toContain(
    "## Notes\n\nThis section is owned by a future workflow.",
  );
  expect(text.match(/Keep setup non-technical\./g)).toHaveLength(1);
  expect(text).toContain("**Instructor**:\nThe team lead preparing a quiz.");
  expect(text).toContain("**Learner**:\nThe person taking the quiz.");
  expect(loadProjectContext(projectRoot)).toEqual({
    terms: [
      {
        name: "Instructor",
        definition: "The team lead preparing a quiz.",
      },
      { name: "Learner", definition: "The person taking the quiz." },
    ],
    constraints: [
      "Keep setup non-technical.",
      "Do not expose engineering scaffolding in the panel.",
    ],
    decisions: ["Start with one video.", "Treat analytics as later work."],
    openQuestions: [
      "How should sharing work?",
      "Who reviews generated questions?",
    ],
  });
});

test("updateProjectContext rejects empty updates without creating CONTEXT.md", () => {
  const projectRoot = tempProject();

  const result = updateProjectContext({
    projectRoot,
    updates: {},
  });

  expect(result).toEqual({
    ok: false,
    code: "empty_update",
    message:
      "Provide at least one term, constraint, decision, or open question.",
  });
  expect(existsSync(CairnDir.projectContextPath(projectRoot))).toBe(false);
});

test("updateProjectContext rejects malformed existing CONTEXT.md", () => {
  const projectRoot = tempProject();
  CairnDir.ensure(projectRoot);
  writeFileSync(
    CairnDir.projectContextPath(projectRoot),
    "# Not Project Context\n",
    "utf8",
  );

  expect(
    update(projectRoot, {
      decisions: ["Use a single quiz flow first."],
    }),
  ).toEqual({
    ok: false,
    code: "invalid_existing_context",
    field: "CONTEXT.md",
    message: "The existing project context is invalid.",
  });
});
