import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type VerifySliceResult = { ok: true } | { ok: false; message: string };

export type VerifySliceInput = {
  projectRoot: string;
  signal?: AbortSignal;
};

type PackageJson = {
  scripts?: Record<string, unknown>;
};

const MAX_MESSAGE_LENGTH = 240;

function shortMessage(message: string) {
  return message.trim().replace(/\s+/g, " ").slice(0, MAX_MESSAGE_LENGTH);
}

function readPackageJson(projectRoot: string): PackageJson | null {
  const packageJsonPath = join(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) return null;

  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function selectScripts(scripts: Record<string, unknown> | undefined) {
  const selected: string[] = [];
  if (typeof scripts?.build === "string") selected.push("build");
  if (typeof scripts?.typecheck === "string") selected.push("typecheck");
  return selected;
}

function outputText(output: Buffer | string | undefined) {
  if (!output) return "";
  return Buffer.isBuffer(output) ? output.toString("utf8") : output;
}

async function runPackageScript({
  projectRoot,
  scriptName,
  signal,
}: {
  projectRoot: string;
  scriptName: string;
  signal?: AbortSignal;
}) {
  const proc = Bun.spawn(["bun", "run", scriptName], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const abort = () => proc.kill();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function verifySlice({
  projectRoot,
  signal,
}: VerifySliceInput): Promise<VerifySliceResult> {
  const packageJson = readPackageJson(projectRoot);
  const scriptNames = selectScripts(packageJson?.scripts);
  if (scriptNames.length === 0) return { ok: true };

  for (const scriptName of scriptNames) {
    let result: Awaited<ReturnType<typeof runPackageScript>>;
    try {
      result = await runPackageScript({ projectRoot, scriptName, signal });
    } catch (err) {
      return {
        ok: false,
        message: shortMessage(
          `${scriptName} check could not run: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }

    if (result.exitCode === 0) continue;

    const output = shortMessage(
      outputText(result.stderr) || outputText(result.stdout),
    );
    return {
      ok: false,
      message: output
        ? shortMessage(`${scriptName} check failed: ${output}`)
        : `${scriptName} check failed.`,
    };
  }

  return { ok: true };
}
