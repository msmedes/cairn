/**
 * Sidecar protocol smoke tests.
 *
 * Spawns the sidecar as a subprocess (no Tauri, no React) and asserts the
 * JSONL event sequence end-to-end. Slice 1 covers the echo behavior; slice 2
 * extends this file with pi-flavored assertions when the real agent lands.
 *
 * Run with `bun test` from the sidecar/ directory.
 */

import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";

const SIDECAR_ENTRY = resolve(import.meta.dir, "..", "index.ts");
const DEFAULT_TIMEOUT_MS = 5000;

type SubprocessHandle = ReturnType<typeof Bun.spawn>;

const liveProcs = new Set<SubprocessHandle>();

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

function spawnSidecar(): SubprocessHandle {
	const proc = Bun.spawn(["bun", "run", SIDECAR_ENTRY], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "ignore",
	});
	liveProcs.add(proc);
	return proc;
}

/**
 * Drains the subprocess stdout, parsing JSONL events one at a time.
 * Resolves when `stopOn` returns true for an event, or rejects on timeout
 * / parse error / EOF before the stop condition.
 */
async function collectEvents(
	proc: SubprocessHandle,
	stopOn: (event: any) => boolean,
	timeoutMs: number,
): Promise<any[]> {
	const events: any[] = [];
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
				let event: any;
				try {
					event = JSON.parse(trimmed);
				} catch (err) {
					throw new Error(`non-JSON sidecar output: ${trimmed}`);
				}
				events.push(event);
				if (stopOn(event)) return events;
			}
		}
	})();

	try {
		return (await Promise.race([drain, timeout])) as any[];
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// fine — stream might already be closed
		}
	}
}

test("sidecar emits ready on startup", async () => {
	const proc = spawnSidecar();
	const events = await collectEvents(
		proc,
		(e) => e.type === "ready",
		DEFAULT_TIMEOUT_MS,
	);
	expect(events[0]?.type).toBe("ready");
});

test("prompt produces echo: <text> as a single text_delta", async () => {
	const proc = spawnSidecar();
	proc.stdin.write(JSON.stringify({ type: "prompt", text: "hello" }) + "\n");

	const events = await collectEvents(
		proc,
		(e) => e.type === "agent_end",
		DEFAULT_TIMEOUT_MS,
	);

	const types = events.map((e) => e.type);
	// ready may arrive before or interleave with our prompt's responses; just
	// assert the prompt sequence is intact and in order.
	const promptStart = types.indexOf("text_delta");
	expect(promptStart).toBeGreaterThan(-1);
	expect(types.slice(promptStart)).toEqual([
		"text_delta",
		"text_done",
		"agent_end",
	]);

	const delta = events.find((e) => e.type === "text_delta");
	expect(delta.delta).toBe("echo: hello");
});

test("malformed input emits an error event without killing the sidecar", async () => {
	const proc = spawnSidecar();
	proc.stdin.write("not json\n");
	proc.stdin.write(JSON.stringify({ type: "prompt", text: "after" }) + "\n");

	const events = await collectEvents(
		proc,
		(e) => e.type === "agent_end",
		DEFAULT_TIMEOUT_MS,
	);

	expect(events.some((e) => e.type === "error")).toBe(true);
	const delta = events.find((e) => e.type === "text_delta");
	expect(delta?.delta).toBe("echo: after");
});
