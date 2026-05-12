import { describe, expect, test } from "vitest";
import { parseTasksArtifact } from "./tasksArtifact";

function validTasksJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
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
          status: "in_progress",
        },
      ],
      ...overrides,
    },
  });
}

describe("parseTasksArtifact", () => {
  test("returns a Tasks envelope for valid tasks.json", () => {
    expect(parseTasksArtifact(validTasksJson())?.data.tasks).toHaveLength(2);
  });

  test("rejects malformed tasks artifacts and unsupported statuses", () => {
    expect(parseTasksArtifact(validTasksJson({ tasks: [] }))).toBeNull();
    expect(
      parseTasksArtifact(
        validTasksJson({
          tasks: [
            {
              slug: "create-the-first-quiz-draft",
              issuePath: "issues/01-create-the-first-quiz-draft.md",
              title: "Create the first quiz draft",
              status: "complete",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(parseTasksArtifact('{"artifact":"tasks"}')).toBeNull();
    expect(parseTasksArtifact("<h1>Tasks</h1>")).toBeNull();
  });
});
