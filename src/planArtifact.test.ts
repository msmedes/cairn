import { describe, expect, test } from "vitest";
import { parsePlanArtifact } from "./planArtifact";

function validPlanJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
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
      ...overrides,
    },
  });
}

describe("parsePlanArtifact", () => {
  test("returns a Plan envelope for valid plan.json", () => {
    expect(parsePlanArtifact(validPlanJson())?.data.title).toBe(
      "First playable quiz",
    );
  });

  test("rejects malformed Plan data", () => {
    expect(parsePlanArtifact(validPlanJson({ pieces: [] }))).toBeNull();
    expect(parsePlanArtifact('{"artifact":"plan"}')).toBeNull();
    expect(parsePlanArtifact("<h1>Plan</h1>")).toBeNull();
  });
});
