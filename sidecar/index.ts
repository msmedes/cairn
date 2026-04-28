/**
 * Guide sidecar — slice 2: real pi session plumbing.
 *
 * Communicates with the Tauri host over LF-delimited JSON on stdio.
 * `init` creates an in-memory pi session rooted at the requested workspace.
 * `prompt` forwards user text to that session and streams translated events
 * back over the existing sidecar protocol.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

type InMsg =
	| { type: "init"; workspacePath?: string; personaPath?: string }
	| { type: "prompt"; text: string };

type OutMsg =
	| { type: "ready" }
	| { type: "text_delta"; delta: string }
	| { type: "text_done" }
	| { type: "tool_start"; name: string }
	| { type: "tool_end"; name: string; ok: boolean }
	| { type: "agent_end" }
	| { type: "error"; message: string };

let session: AgentSession | null = null;
let unsubscribeSession: (() => void) | null = null;
let stdinBuffer = "";
let inputQueue = Promise.resolve();

function emit(msg: OutMsg) {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

function formatError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function disposeSession() {
	unsubscribeSession?.();
	unsubscribeSession = null;
	session?.dispose();
	session = null;
}

function wireSessionEvents(nextSession: AgentSession) {
	unsubscribeSession = nextSession.subscribe((event: AgentSessionEvent) => {
		switch (event.type) {
			case "message_update":
				switch (event.assistantMessageEvent.type) {
					case "text_delta":
						emit({ type: "text_delta", delta: event.assistantMessageEvent.delta });
						break;
					case "text_end":
						emit({ type: "text_done" });
						break;
				}
				break;
			case "tool_execution_start":
				emit({ type: "tool_start", name: event.toolName });
				break;
			case "tool_execution_end":
				emit({
					type: "tool_end",
					name: event.toolName,
					ok: !event.isError,
				});
				break;
			case "agent_end":
				emit({ type: "agent_end" });
				break;
		}
	});
}

async function handleInit(msg: Extract<InMsg, { type: "init" }>) {
	disposeSession();

	const cwd = resolve(msg.workspacePath ?? process.cwd());
	mkdirSync(cwd, { recursive: true });

	const { session: nextSession } = await createAgentSession({
		cwd,
		sessionManager: SessionManager.inMemory(cwd),
	});

	session = nextSession;
	wireSessionEvents(nextSession);
	emit({ type: "ready" });
}

async function handlePrompt(text: string) {
	if (!session) {
		throw new Error("session not initialized");
	}
	await session.prompt(text);
}

async function handleLine(line: string) {
	const trimmed = line.trim();
	if (!trimmed) return;

	let msg: InMsg;
	try {
		msg = JSON.parse(trimmed) as InMsg;
	} catch (err) {
		emit({ type: "error", message: `bad input: ${formatError(err)}` });
		return;
	}

	switch (msg.type) {
		case "init":
			await handleInit(msg);
			break;
		case "prompt":
			await handlePrompt(msg.text);
			break;
	}
}

function queueLine(line: string) {
	inputQueue = inputQueue
		.then(() => handleLine(line))
		.catch((err) => {
			emit({ type: "error", message: formatError(err) });
		});
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	stdinBuffer += chunk;

	while (true) {
		const newlineIndex = stdinBuffer.indexOf("\n");
		if (newlineIndex === -1) break;

		const line = stdinBuffer.slice(0, newlineIndex).replace(/\r$/, "");
		stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
		queueLine(line);
	}
});

process.stdin.on("end", () => {
	disposeSession();
	process.exit(0);
});

process.stdin.resume();
