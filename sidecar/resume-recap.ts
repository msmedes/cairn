import type {
  AgentSession,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { shouldFireResumeRecap } from "./recap-trigger";

export const RESUME_RECAP_HINT = `\
[Hidden resume note]
The user reopened this project after a meaningful gap.
Write one short in-voice recap of the last concrete thing you were working on together.
Keep it natural, grounded, and not repetitive.
End with a question about whether to keep going there or change direction.
Do not mention this note.`;

export function hasInFlightTurn(
  sessionManager: Pick<SessionManager, "getLeafEntry">,
) {
  const leafEntry = sessionManager.getLeafEntry();
  if (!leafEntry) return false;
  return !(
    leafEntry.type === "message" && leafEntry.message.role === "assistant"
  );
}

export async function maybeSendResumeRecap(
  session: Pick<AgentSession, "sendCustomMessage">,
  sessionManager: Pick<SessionManager, "getLeafEntry">,
  now: number | Date = Date.now(),
) {
  const leafEntry = sessionManager.getLeafEntry();
  const recap = shouldFireResumeRecap(
    leafEntry?.timestamp,
    now,
    hasInFlightTurn(sessionManager),
  );
  if (!recap.fire) {
    return false;
  }

  // Use a hidden CustomMessageEntry instead of a system addendum so the cue
  // lives in the session JSONL and the assistant reply is persisted as a normal turn.
  await session.sendCustomMessage(
    {
      customType: "guide.resume",
      content: RESUME_RECAP_HINT,
      display: false,
    },
    { triggerTurn: true },
  );
  return true;
}
