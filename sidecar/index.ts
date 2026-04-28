/**
 * Guide sidecar — slice 1: echo plumbing.
 *
 * Communicates with the Tauri host over line-delimited JSON on stdio.
 * No agent, no persona, no model — just round-trips prompts as "echo: <text>"
 * so we can verify the Rust ⇄ sidecar wiring end-to-end.
 *
 * Inputs (stdin, one JSON object per line):
 *   {"type":"prompt","text":"..."}
 *
 * Outputs (stdout, one JSON object per line):
 *   {"type":"ready"}                          // emitted once on startup
 *   {"type":"text_delta","delta":"..."}       // streamed assistant text
 *   {"type":"text_done"}                      // current assistant turn finished
 *   {"type":"agent_end"}                      // session turn fully done
 *   {"type":"error","message":"..."}          // sidecar-level failure
 */

import { createInterface } from "node:readline";

type InMsg =
	| { type: "prompt"; text: string }
	| { type: "init"; workspacePath?: string; personaPath?: string };

type OutMsg =
	| { type: "ready" }
	| { type: "text_delta"; delta: string }
	| { type: "text_done" }
	| { type: "agent_end" }
	| { type: "error"; message: string };

function emit(msg: OutMsg) {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

function handlePrompt(text: string) {
	emit({ type: "text_delta", delta: `echo: ${text}` });
	emit({ type: "text_done" });
	emit({ type: "agent_end" });
}

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;
	let msg: InMsg;
	try {
		msg = JSON.parse(trimmed) as InMsg;
	} catch (err: any) {
		emit({ type: "error", message: `bad input: ${err?.message ?? err}` });
		return;
	}
	if (msg.type === "prompt") {
		handlePrompt(msg.text);
	}
});

rl.on("close", () => {
	process.exit(0);
});

// Announce ready as soon as the sidecar is up.
emit({ type: "ready" });
