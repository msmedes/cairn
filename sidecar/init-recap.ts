import type { AgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import {
	type HydrateEvent,
	translateSessionEntriesToHydrateEvent,
} from "./hydrate";
import { maybeSendResumeRecap } from "./resume-recap";

type InitRecapHooks = {
	emitHydrate: (event: HydrateEvent) => void;
	onRecapError: (error: unknown) => void;
};

export async function emitHydrateAndMaybeResumeRecap(
	session: Pick<AgentSession, "sendCustomMessage">,
	sessionManager: Pick<SessionManager, "getEntries" | "getLeafEntry">,
	hooks: InitRecapHooks,
) {
	hooks.emitHydrate(translateSessionEntriesToHydrateEvent(sessionManager.getEntries()));

	try {
		const fired = await maybeSendResumeRecap(session, sessionManager);
		if (fired) {
			hooks.emitHydrate(
				translateSessionEntriesToHydrateEvent(sessionManager.getEntries()),
			);
		}
	} catch (error) {
		hooks.onRecapError(error);
	}
}
