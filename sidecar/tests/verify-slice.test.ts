import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifySlice } from "../verify-slice";

function createProject() {
  return mkdtempSync(join(tmpdir(), "cairn-verify-slice-"));
}

function writePackageJson(projectRoot: string, packageJson: unknown) {
  writeFileSync(
    join(projectRoot, "package.json"),
    JSON.stringify(packageJson, null, 2),
    "utf8",
  );
}

test("verify_slice build-check runs a passing build script", async () => {
  const projectRoot = createProject();
  mkdirSync(join(projectRoot, "scripts"));
  writeFileSync(
    join(projectRoot, "scripts", "build-ok.js"),
    "process.exit(0);\n",
    "utf8",
  );
  writePackageJson(projectRoot, {
    scripts: {
      build: "bun scripts/build-ok.js",
    },
  });

  await expect(verifySlice({ projectRoot })).resolves.toEqual({ ok: true });
});

test("verify_slice build-check reports a failing build script", async () => {
  const projectRoot = createProject();
  mkdirSync(join(projectRoot, "scripts"));
  writeFileSync(
    join(projectRoot, "scripts", "build-fail.js"),
    "console.error('nope'); process.exit(1);\n",
    "utf8",
  );
  writePackageJson(projectRoot, {
    scripts: {
      build: "bun scripts/build-fail.js",
    },
  });

  const result = await verifySlice({ projectRoot });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain("build");
    expect(result.message.length).toBeLessThanOrEqual(240);
  }
});

test("verify_slice build-check uses typecheck when build is absent", async () => {
  const projectRoot = createProject();
  writePackageJson(projectRoot, {
    scripts: {
      typecheck: "bun --version",
    },
  });

  await expect(verifySlice({ projectRoot })).resolves.toEqual({ ok: true });
});

test("verify_slice build-check reports failing typecheck after a passing build", async () => {
  const projectRoot = createProject();
  mkdirSync(join(projectRoot, "scripts"));
  writeFileSync(
    join(projectRoot, "scripts", "build-ok.js"),
    "process.exit(0);\n",
    "utf8",
  );
  writeFileSync(
    join(projectRoot, "scripts", "typecheck-fail.js"),
    "console.error('types failed'); process.exit(1);\n",
    "utf8",
  );
  writePackageJson(projectRoot, {
    scripts: {
      build: "bun scripts/build-ok.js",
      typecheck: "bun scripts/typecheck-fail.js",
    },
  });

  const result = await verifySlice({ projectRoot });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain("typecheck");
  }
});

test("verify_slice succeeds silently when no build or typecheck script exists", async () => {
  const projectRoot = createProject();
  writePackageJson(projectRoot, {
    scripts: {
      test: "bun test",
    },
  });

  await expect(verifySlice({ projectRoot })).resolves.toEqual({ ok: true });
});
