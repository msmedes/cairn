/**
 * Sidecar protocol smoke test.
 *
 * Spawns the sidecar as a subprocess (no Tauri), initializes a real pi
 * session, and asserts the JSONL event sequence for a basic prompt.
 *
 * Run with `bun test` from the sidecar/ directory.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { loadRepoLocalEnv } from "../env";

const SIDECAR_ENTRY = resolve(import.meta.dir, "..", "index.ts");
const DEFAULT_TIMEOUT_MS = 60_000;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type SidecarEvent = { type: string } & Record<string, JsonValue>;
type SubprocessHandle = ReturnType<typeof Bun.spawn>;

const liveProcs = new Set<SubprocessHandle>();
loadRepoLocalEnv();
const authCheck = getAuthCheck();

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

function getAuthCheck(): { ok: true } | { ok: false; reason: string } {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	if (modelRegistry.getAvailable().length > 0) {
		return { ok: true };
	}
	return {
		ok: false,
		reason:
			"Skipping sidecar protocol smoke test: no pi auth is configured. Set an API key such as ANTHROPIC_API_KEY or log in with pi first.",
	};
}

function spawnSidecar(): SubprocessHandle {
	const proc = Bun.spawn(["bun", "run", SIDECAR_ENTRY], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "ignore",
	});
	liveProcs.add(proc);
	return proc;
}

function createWorkspace(): string {
	return mkdtempSync(join(tmpdir(), "guide-sidecar-"));
}

function createPersonaFile(contents = "You are the Guide. Ask one short scoping question at a time."): string {
	const workspacePath = createWorkspace();
	const personaPath = join(workspacePath, "persona.md");
	writeFileSync(personaPath, contents, "utf8");
	return personaPath;
}

function writeToSidecar(proc: SubprocessHandle, line: string) {
	const stdin = proc.stdin;
	if (!stdin || typeof stdin === "number") {
		throw new Error("sidecar stdin is not writable");
	}
	stdin.write(line);
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

if (!authCheck.ok) {
	console.warn(authCheck.reason);
	test.skip("sidecar protocol smoke test requires configured pi auth", () => {});
} else {
	test(
		"init then prompt yields ready, streaming text, and agent_end",
		async () => {
			const proc = spawnSidecar();
			const workspacePath = createWorkspace();
			const personaPath = createPersonaFile();

			writeToSidecar(
				proc,
				JSON.stringify({ type: "init", workspacePath, personaPath }) + "\n",
			);

			const readyEvents = await collectEvents(
				proc,
				(event) => event.type === "ready",
				DEFAULT_TIMEOUT_MS,
			);
			expect(readyEvents.at(-1)?.type).toBe("ready");

			writeToSidecar(
				proc,
				JSON.stringify({ type: "prompt", text: "what's 2 + 2?" }) + "\n",
			);

			const promptEvents = await collectEvents(
				proc,
				(event) => event.type === "agent_end",
				DEFAULT_TIMEOUT_MS,
			);

			expect(promptEvents.some((event) => event.type === "text_delta")).toBe(true);
			expect(promptEvents.at(-1)?.type).toBe("agent_end");

			const textDoneIndex = promptEvents.findIndex(
				(event) => event.type === "text_done",
			);
			const agentEndIndex = promptEvents.findIndex(
				(event) => event.type === "agent_end",
			);
			expect(textDoneIndex).toBeGreaterThan(-1);
			expect(agentEndIndex).toBeGreaterThan(textDoneIndex);
		},
		DEFAULT_TIMEOUT_MS,
	);
}

test("malformed input emits an error event without killing the sidecar", async () => {
	const proc = spawnSidecar();
	writeToSidecar(proc, "not json\n");

	const errorEvents = await collectEvents(
		proc,
		(event) => event.type === "error",
		DEFAULT_TIMEOUT_MS,
	);
	expect(errorEvents.at(-1)?.type).toBe("error");

	if (authCheck.ok) {
		const workspacePath = createWorkspace();
		const personaPath = createPersonaFile();
		writeToSidecar(
			proc,
			JSON.stringify({ type: "init", workspacePath, personaPath }) + "\n",
		);
		const readyEvents = await collectEvents(
			proc,
			(event) => event.type === "ready",
			DEFAULT_TIMEOUT_MS,
		);
		expect(readyEvents.at(-1)?.type).toBe("ready");
	}
});

test("init emits an error event when personaPath does not exist", async () => {
	const proc = spawnSidecar();
	const workspacePath = createWorkspace();
	const missingPersonaPath = join(workspacePath, "missing-persona.md");

	writeToSidecar(
		proc,
		JSON.stringify({
			type: "init",
			workspacePath,
			personaPath: missingPersonaPath,
		}) + "\n",
	);

	const errorEvents = await collectEvents(
		proc,
		(event) => event.type === "error",
		DEFAULT_TIMEOUT_MS,
	);
	expect(errorEvents.at(-1)?.type).toBe("error");
	expect(errorEvents.at(-1)?.message).toContain("missing-persona.md");
});
