import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BriefArtifactData,
  createBriefArtifact,
  loadBriefArtifact,
  updateBriefArtifact,
} from "../../artifacts/brief-artifact";
import { CairnDir } from "../../project/cairn-dir";

function tempProject() {
  return mkdtempSync(join(tmpdir(), "cairn-brief-artifact-"));
}

function validBrief(
  overrides: Partial<BriefArtifactData> = {},
): BriefArtifactData {
  return {
    title: "Video Quiz Helper",
    summary: "A small tool for turning training videos into simple quizzes.",
    audience: "Team leads who need lightweight training checks.",
    success: "A lead can paste in a video, add questions, and share the quiz.",
    sections: [
      {
        heading: "What it does first",
        body: "It helps a lead create one quiz from one training video.",
      },
    ],
    ...overrides,
  };
}

test("createBriefArtifact persists canonical brief.json without writing brief.html", () => {
  const projectRoot = tempProject();
  const result = createBriefArtifact({
    projectRoot,
    data: validBrief(),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: true,
    artifact: "brief",
    path: "brief.json",
    schemaVersion: 1,
    title: "Video Quiz Helper",
    sectionCount: 1,
  });
  expect(existsSync(join(CairnDir.root(projectRoot), "brief.html"))).toBe(
    false,
  );

  const parsed = JSON.parse(
    readFileSync(CairnDir.briefPath(projectRoot), "utf8"),
  );
  expect(parsed).toEqual({
    artifact: "brief",
    schemaVersion: 1,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    data: validBrief(),
  });
  expect(loadBriefArtifact(projectRoot)?.data.title).toBe("Video Quiz Helper");
});

test("createBriefArtifact refuses to overwrite an existing brief.json", () => {
  const projectRoot = tempProject();
  createBriefArtifact({
    projectRoot,
    data: validBrief(),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  const result = createBriefArtifact({
    projectRoot,
    data: validBrief({ title: "Replacement Brief" }),
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: false,
    code: "brief_already_exists",
    field: "brief.json",
    message:
      "The Brief already exists. Use update_brief_artifact to revise it.",
  });
  expect(loadBriefArtifact(projectRoot)?.data.title).toBe("Video Quiz Helper");
});

test("loadBriefArtifact rejects malformed brief.json envelopes", () => {
  const projectRoot = tempProject();
  CairnDir.ensure(projectRoot);
  writeFileSync(
    CairnDir.briefPath(projectRoot),
    '{"artifact":"brief"}',
    "utf8",
  );

  expect(loadBriefArtifact(projectRoot)).toBeNull();
});

test("updateBriefArtifact preserves createdAt and records the update reason", () => {
  const projectRoot = tempProject();
  createBriefArtifact({
    projectRoot,
    data: validBrief(),
    now: () => new Date("2026-05-01T12:00:00.000Z"),
  });

  const updated = updateBriefArtifact({
    projectRoot,
    data: validBrief({ title: "Updated Quiz Helper" }),
    reason: "User clarified the audience.",
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(updated).toMatchObject({
    ok: true,
    artifact: "brief",
    path: "brief.json",
    title: "Updated Quiz Helper",
  });
  expect(existsSync(join(CairnDir.root(projectRoot), "brief.html"))).toBe(
    false,
  );

  const parsed = JSON.parse(
    readFileSync(CairnDir.briefPath(projectRoot), "utf8"),
  );
  expect(parsed.createdAt).toBe("2026-05-01T12:00:00.000Z");
  expect(parsed.updatedAt).toBe("2026-05-01T13:00:00.000Z");
  expect(parsed.lastUpdateReason).toBe("User clarified the audience.");
});

test("updateBriefArtifact identifies an invalid existing brief.json", () => {
  const projectRoot = tempProject();
  CairnDir.ensure(projectRoot);
  writeFileSync(
    CairnDir.briefPath(projectRoot),
    '{"artifact":"brief"}',
    "utf8",
  );

  const result = updateBriefArtifact({
    projectRoot,
    data: validBrief(),
    reason: "User clarified the audience.",
    now: () => new Date("2026-05-01T13:00:00.000Z"),
  });

  expect(result).toEqual({
    ok: false,
    code: "invalid_existing_artifact",
    field: "brief.json",
    message: "The existing Brief artifact is invalid.",
  });
});
