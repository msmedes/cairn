const RECAP_THRESHOLD_MS = 30 * 60 * 1000;

export type RecapTriggerResult = {
	fire: boolean;
};

export function shouldFireResumeRecap(
	lastEntryTimestamp: string | null | undefined,
	now: number | Date,
	hasInFlightTurn: boolean,
): RecapTriggerResult {
	if (!lastEntryTimestamp || hasInFlightTurn) {
		return { fire: false };
	}

	const lastEntryTimeMs = Date.parse(lastEntryTimestamp);
	const nowMs = now instanceof Date ? now.getTime() : now;
	if (!Number.isFinite(lastEntryTimeMs) || !Number.isFinite(nowMs)) {
		return { fire: false };
	}

	return { fire: nowMs - lastEntryTimeMs > RECAP_THRESHOLD_MS };
}

export { RECAP_THRESHOLD_MS };
