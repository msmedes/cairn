import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPlanArtifact,
  loadPlanArtifact,
  type PlanArtifactData,
  updatePlanArtifact,
} from "../plan-artifact";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "guide-plan-artifact-"));
}

function validPlan(
  overrides: Partial<PlanArtifactData> = {},
): PlanArtifactData {
  return {
    title: "First playable quiz",
    summary: "Start with one video and one shareable quiz.",
    fromBrief:
      "The brief asks for lightweight checks after training videos, so the first slice proves one quiz end to end.",
    outcomes: [
      "You'll be able to paste in one training video.",
      "You'll be able to add a few questions for that video.",
    ],
    pieces: [
      "Create the first quiz draft",
      "Preview the quiz as a learner",
      "Share the finished quiz",
    ],
    notYet: ["Team analytics", "Question banks"],
    ...overrides,
  };
}

test("createPlanArtifact persists canonical plan.json without writing plan.html", () => {
  const projectRoot = tempProject();
  const result = createPlanArtifact({
    projectRoot,
    data: validPlan(),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: true,
    artifact: "plan",
    path: "plan.json",
    schemaVersion: 1,
    title: "First playable quiz",
    pieceCount: 3,
  });
  expect(existsSync(join(projectRoot, "plan.html"))).toBe(false);

  const parsed = JSON.parse(
    readFileSync(join(projectRoot, "plan.json"), "utf8"),
  );
  expect(parsed).toEqual({
    artifact: "plan",
    schemaVersion: 1,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    data: validPlan(),
  });
  expect(loadPlanArtifact(projectRoot)?.data.title).toBe("First playable quiz");
});

test("createPlanArtifact returns a structured field error for invalid plan data", () => {
  const projectRoot = tempProject();
  const result = createPlanArtifact({
    projectRoot,
    data: validPlan({ pieces: [] }),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: false,
    code: "validation_error",
    field: "data.pieces",
    message: "At least 3 Plan pieces are required.",
  });
  expect(existsSync(join(projectRoot, "plan.json"))).toBe(false);
});

test("createPlanArtifact enforces Plan list bounds", () => {
  const projectRoot = tempProject();
  const tooFewNotYet = createPlanArtifact({
    projectRoot,
    data: validPlan({ notYet: ["Team analytics"] }),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  expect(tooFewNotYet).toEqual({
    ok: false,
    code: "validation_error",
    field: "data.notYet",
    message: "At least 2 Plan not-yet items are required.",
  });
});

test("updatePlanArtifact requires a short reason and preserves createdAt", () => {
  const projectRoot = tempProject();
  createPlanArtifact({
    projectRoot,
    data: validPlan(),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  const missingReason = updatePlanArtifact({
    projectRoot,
    data: validPlan({ title: "Updated first quiz" }),
    reason: "  ",
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(missingReason).toEqual({
    ok: false,
    code: "validation_error",
    field: "reason",
    message: "Update reason is required.",
  });

  const updated = updatePlanArtifact({
    projectRoot,
    data: validPlan({ title: "Updated first quiz" }),
    reason: "User changed the first slice.",
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(updated).toMatchObject({
    ok: true,
    artifact: "plan",
    path: "plan.json",
    title: "Updated first quiz",
  });
  expect(existsSync(join(projectRoot, "plan.html"))).toBe(false);

  const parsed = JSON.parse(
    readFileSync(join(projectRoot, "plan.json"), "utf8"),
  );
  expect(parsed.createdAt).toBe("2026-05-01T12:00:00.000Z");
  expect(parsed.updatedAt).toBe("2026-05-01T13:00:00.000Z");
  expect(parsed.lastUpdateReason).toBe("User changed the first slice.");
});

test("updatePlanArtifact identifies an invalid existing plan.json", () => {
  const projectRoot = tempProject();
  writeFileSync(join(projectRoot, "plan.json"), '{"artifact":"plan"}', "utf8");

  const result = updatePlanArtifact({
    projectRoot,
    data: validPlan(),
    reason: "User changed the first slice.",
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: false,
    code: "invalid_existing_artifact",
    field: "plan.json",
    message: "The existing Plan artifact is invalid.",
  });
});
