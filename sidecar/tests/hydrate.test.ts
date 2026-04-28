import { expect, test } from "bun:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { translateSessionEntriesToHydrateEvent } from "../hydrate";

function messageEntry(
	id: string,
	role: "user" | "assistant" | "toolResult",
	content: unknown,
): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-04-28T00:00:00.000Z",
		message: {
			role,
			content,
			timestamp: Date.now(),
			...(role === "assistant"
				? {
						api: "anthropic",
						provider: "anthropic",
						model: "claude-sonnet-4-5",
						usage: {
							input: 1,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 2,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
						stopReason: "stop" as const,
					}
				: role === "toolResult"
					? {
							toolCallId: "tool-1",
							toolName: "read",
							isError: false,
						}
					: {}),
		} as SessionEntry extends { message: infer Message } ? Message : never,
	};
}

test("translateSessionEntriesToHydrateEvent preserves user/assistant order and skips tool output", () => {
	const entries: SessionEntry[] = [
		messageEntry("user-1", "user", "Build me a quiz app."),
		messageEntry("tool-1", "toolResult", [
			{ type: "text", text: "tool output that should not hydrate" },
		]),
		messageEntry("assistant-1", "assistant", [
			{ type: "thinking", thinking: "private" } as never,
			{ type: "text", text: "Who will write the questions?" },
		]),
		{
			type: "custom_message",
			id: "custom-1",
			parentId: null,
			timestamp: "2026-04-28T00:00:01.000Z",
			customType: "guide.resume",
			content: "hidden recap",
			display: false,
		},
		messageEntry("user-2", "user", [
			{ type: "text", text: "Teachers will." },
			{ type: "image", image: "ignored" } as never,
		]),
	];

	expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
		type: "hydrate",
		messages: [
			{
				id: "user-1",
				role: "user",
				text: "Build me a quiz app.",
				done: true,
			},
			{
				id: "assistant-1",
				role: "assistant",
				text: "Who will write the questions?",
				done: true,
			},
			{
				id: "user-2",
				role: "user",
				text: "Teachers will.",
				done: true,
			},
		],
	});
});

test("translateSessionEntriesToHydrateEvent drops non-text user and assistant entries", () => {
	const entries: SessionEntry[] = [
		messageEntry("assistant-1", "assistant", [
			{ type: "toolCall", toolCallId: "call-1" } as never,
		]),
		messageEntry("user-1", "user", [{ type: "image", image: "ignored" } as never]),
	];

	expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
		type: "hydrate",
		messages: [],
	});
});

test("translateSessionEntriesToHydrateEvent preserves multi-block text exactly", () => {
	const entries: SessionEntry[] = [
		messageEntry("assistant-1", "assistant", [
			{ type: "text", text: "Hello" },
			{ type: "text", text: " world" },
			{ type: "text", text: " again" },
		]),
	];

	expect(translateSessionEntriesToHydrateEvent(entries)).toEqual({
		type: "hydrate",
		messages: [
			{
				id: "assistant-1",
				role: "assistant",
				text: "Hello world again",
				done: true,
			},
		],
	});
});
