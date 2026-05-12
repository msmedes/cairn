# PRD — Slice 12: Grouped clarifying questions

## Problem Statement

When the Cairn needs the user to make a decision — what audience the project is for, which of three approaches to take, whether to include a feature in this slice — its only current option is to type the question (and the possible answers) in plain chat. That works for one-off yes/no clarifications, but it falls apart in three places.

First, when the trade-offs matter, the user has to parse a long bulleted message and reply in free text. Two readers of the same bulleted prompt give differently-shaped answers ("yes the first one" vs "definitely B" vs "let's go with the simpler one"); the Cairn then has to translate those back to options, sometimes re-asking when the answer is ambiguous. Time and trust leak at the translation step.

Second, when the Cairn legitimately has *several* related questions for one decision point (e.g. "who is this for? + what's the must-have feature? + when do you want it by?"), it ends up either asking them one at a time across many turns (slow, the user loses the through-line) or batching them into one wall of chat text that's hard to answer coherently. Neither is good. The natural pattern — a single panel that shows all the decisions side-by-side, like Claude Code's question UI — has no surface in Cairn today.

Third, structured options are a forcing function on the Cairn itself. When the model has to author concrete option labels with descriptions, it must commit to a clear framing of the decision rather than hedging in chat prose. The constraint produces better questions.

The pi extension ecosystem has a working version of this pattern (`@juicesharp/rpiv-ask-user-question`), but its renderer is pi-tui — a terminal dialog that has no surface in Cairn's React webview. Cairn embeds pi via `createAgentSession` and supplies the entire UI through the Tauri host; pi extensions that draw via `ctx.ui.custom` produce a `no_ui` error in this environment. The schema and prompt copy from that package are worth borrowing; the renderer is not.

## Solution

The Cairn gains a new tool, `ask_user_question`, that it can call when scoping or slicing needs a concrete decision. The tool accepts between one and four grouped questions, each with two to four labeled options, and optional multi-select. When the Cairn calls it, the user sees a question card mount in the composer area in place of the text input. The card stays in view — anchored at the bottom of the chat pane, like the Composer — until the user submits their answers or skips.

A single-question card shows the question, a vertical list of selectable options with one-line descriptions, and a Submit button. A multi-question card adds a tab strip so the user can step through each question, and Submit becomes available only when every question has an answer. Single-select questions include an optional "Type your own answer" free-text row so the user is never forced into a wrong-fit option. Multi-select questions render as checkboxes. A Skip button lets the user dismiss the card and continue in chat without locking the conversation; the Cairn receives a cancelled-result and adapts.

Submission resumes the Cairn's turn with structured answers, so the chat continues immediately rather than the model having to re-parse a free-text reply. Behind the scenes, the agent's tool call parks until the user acts; the parked call resolves with whatever the user picked (or with `cancelled: true` on Skip).

## User Stories

1. As the Cairn, when scoping requires the user to pick between mutually exclusive directions, I want to ask grouped questions with concrete options so the user can see all the trade-offs side-by-side rather than translating prose answers back into discrete choices.
2. As the user, when the Cairn asks me to make a decision, I want a clearly-rendered question card with labeled options so I'm not parsing a wall of bulleted text in chat.
3. As the user, when none of the offered options fits what I actually want, I want to type my own answer so I'm not forced into a wrong choice.
4. As the user, when I don't want to engage with the structured question — maybe I want to back up and discuss something else — I want a Skip affordance so the conversation isn't locked.
5. As the Cairn, I want to ask up to four related questions in a single card so the user sees the whole decision context together and submits a coherent set of answers.
6. As the Cairn, I want to ask a multi-select question (e.g. "which of these matter most?") so the user can pick more than one option when that's the honest shape of the choice.
7. As the user, when a multi-question card is open, I want each question reachable as a tab so I can review what's being asked before committing.
8. As the user, when a question card is pending, I want it to stay in view as I scroll the chat history so I can't lose track of what the Cairn is waiting on.
9. As the user, when I submit my answers, I want the Cairn to continue immediately rather than re-asking or repeating itself in different words.
10. As the developer, when the model authors a question with too few or too many options (or too many questions), I want validation to reject the tool call before any UI shows so the user never sees malformed structures.
11. As the developer, when the model tries to author a reserved UI label like "Other" or "Type something.", I want validation to reject it so the React UI's sentinel slots stay sentinel and can't collide with model-authored options.
12. As the developer, when the user submits an answer while the agent's turn is parked on the tool call, I want the answer to bypass the regular stdin queue so the parked tool resolves without deadlocking on the in-flight prompt.
13. As the developer, when the user closes the app while a question is pending, I want the existing dangling tool call recovery path to handle the unresolved call so the next session opens cleanly and the Cairn can re-ask if it still wants the answer.
14. As the developer, when I write future tools that need to wait on the user (a one-off confirmation, an attachment picker, a destructive-action gate), I want the pending-resolver pattern available as a reusable primitive so the IPC plumbing isn't reinvented per-tool.
15. As the Cairn, I want the tool description and prompt guidelines to teach me *when* to reach for grouped questions vs. plain chat so I don't over-use a heavy-weight surface for trivial clarifications.

## Implementation Decisions

A new tool, `ask_user_question`, registered alongside the existing Cairn tools through `customTools` in the same factory that already supplies `create_brief_artifact`, `spawn_subagent`, and friends. The tool body lives in a new module under the sidecar's tools directory; its public surface is a single `defineTool` registration plus the schema and validator that the test suite exercises directly.

The schema is adapted from `@juicesharp/rpiv-ask-user-question` (MIT) — questions, options with `label` and `description`, optional `multiSelect`, the 1–4 question / 2–4 option limits, and the label/header length caps. The `preview` and per-option `notes` fields from the original package are intentionally dropped for this slice: their value is in a side-by-side terminal layout we don't have, and the React equivalent is enough additional UI work to deserve its own decision. Attribution to the original package goes in the schema module header.

Validation is a deep module: it runs in isolation against the parsed parameters and returns a structured ok-or-error result with a discriminated `error` code. The errors it can return — `no_questions`, `duplicate_question`, `duplicate_option_label`, `reserved_label` — match the package's vocabulary so the existing prompt guidelines remain accurate. Reserved option labels for Cairn are `"Other"` and `"Type something."`; both are claimed by the React sentinel rows and the model must not author them.

A pending-resolver registry is the second deep module. Keyed by pi's `toolCallId` (which is unique per agent turn), it exposes `registerPending(id)` returning a promise, `resolvePending(id, result)` to fulfill it, and `cancelAllPending(reason)` for session-teardown. The tool's `execute` calls `registerPending`, emits the question bundle as an OutMsg over stdio, and `await`s the returned promise. When the user submits, the answer arrives over stdio, the index dispatcher calls `resolvePending`, and the tool returns the structured answers as its result.

The sidecar's existing stdin loop processes messages serially through `inputQueue` — each `handleLine` awaits the previous one. This is fine for prompts and project mutations but would deadlock on `answer_question`: the answer message would queue behind the still-running `handlePrompt` that's currently parked on the tool call. The dispatcher therefore peeks the parsed message type *before* enqueuing; `answer_question` short-circuits, resolves the pending entry directly, and never touches `inputQueue`. All other message types go through the queue unchanged.

The OutMsg union grows by one variant: `ask_user_question` carrying the call id and the validated question bundle. The InMsg union grows by one variant: `answer_question` carrying the call id, the answers array (one entry per question), a cancelled flag, and the kind discriminator (`option` / `custom` / `multi` / `cancel`). Both shapes are typed at both ends so the Rust passthrough stays a thin forwarder.

The Rust passthrough is a single new `#[tauri::command]`: `submit_question_answer`. It serializes its arguments into the InMsg shape and writes them via the existing `write_line` path. No new state, no new event channel — the `sidecar-event` channel that already carries every OutMsg type carries the question bundle to the frontend.

The frontend extends `useSidecarSession`'s event handler with a new case for `ask_user_question`. The hook tracks a `pendingQuestion` state (the bundle + the call id), exposes it alongside `messages` and `sending`, and offers two new actions: `submitQuestionAnswer(answers)` and `cancelQuestion()`. When the user invokes either, the hook calls `submit_question_answer` and clears the local state; the next agent event (text delta resuming the turn, or the next tool call, or `agent_end`) flows through unchanged.

`App.tsx` renders a new `QuestionCard` component when `pendingQuestion` is non-null, mounted in the composer slot in place of the `Composer`. The card owns its own selection state and validates locally — Submit is disabled until every question has a selection (or a custom answer for single-select). The component receives the bundle, the submit callback, and the skip callback as props; it does not call `invoke` directly so it stays testable as a pure React component.

Per-question UI: single-select renders as a vertical radio list with the description under each label, followed by a "Type your own answer" row that expands into a free-text input when selected. Multi-select renders as a checkbox list with no free-text row. Multi-question bundles render a tab strip above the question body, with a per-tab dot indicator showing whether that question has been answered. Submit and Skip live in a footer row below the tabs.

The tool description and `promptGuidelines` for `ask_user_question` are adapted from the rpiv package's copy — that copy was tuned for an LLM audience and is high-quality. The Cairn-specific edits: drop references to the dropped fields (`preview`, notes), translate any pi-tui-specific affordances ("press `n` to attach a note") into the Cairn shape, and add one Cairn-specific guideline that nudges the model to prefer grouped questions over single-question chat when the user is making a real choice rather than a casual clarification.

The Cairn persona prompt does not need to change. The tool description plus prompt guidelines are surfaced to the model through the standard pi tool-loading path, the same way every other Cairn tool is taught.

Dangling tool call recovery (already in the sidecar) handles app-restart cleanly: if a question was pending when the app closed, the next session sees an unresolved tool call and emits a synthetic error result. The Cairn picks up the next turn and is free to re-ask. No new persistence layer.

## Testing Decisions

The deep modules — schema validation and the pending-resolver registry — get focused unit tests that exercise external behavior. Validation tests cover:
- happy path (single and multi-question bundles)
- too few questions / too many questions
- too few options / too many options per question
- duplicate question text within a bundle
- duplicate option label within a question
- reserved label rejection (`"Other"`, `"Type something."`, case-insensitive)

Pending-resolver tests cover:
- `registerPending` then `resolvePending` returns the result through the promise
- `resolvePending` for an unknown id returns false and does not throw
- `cancelAllPending` rejects every pending entry with the given reason
- a second `resolvePending` for the same id after the first is a no-op

Both modules follow the bun-test pattern already in `sidecar/tests/artifacts/` — small per-test fixtures, no shared state, no mocking of pi internals.

The React `QuestionCard` component gets at least one component test that simulates: render a multi-question bundle, pick options on each tab, click Submit, assert the submit callback received the correctly-shaped answers. The pattern matches `useComposerAttachments.test.ts` and the existing `App.test.tsx`. A second test covers the Skip path. The free-text "Type your own answer" path is covered in the same component test rather than spun out separately.

What is deliberately *not* tested: the full sidecar↔Rust↔frontend round trip. The existing codebase doesn't carry end-to-end tests of this shape, and adding one for this slice would mean inventing the test infrastructure. The IPC contract is captured by the typed message shapes on both sides; the runtime behavior is covered by manual testing during development. Out-of-band stdin routing is the riskiest piece and is best verified by exercising the live app — a unit test of the dispatcher would be a paraphrase of the implementation.

## Out of Scope

- **Per-option `preview` content** (side-by-side terminal previews of code/diagrams/configs). The rpiv package's most complex feature. Worth its own slice if the Cairn ever needs to show comparative visual artifacts inside a question.
- **Per-option `notes` annotations** (free text attached to a specific selection). Same reasoning — extra UI surface, low value for the v1 use cases.
- **Multi-locale UI**. Cairn is English-only today; the rpiv package's i18n bridge is not ported.
- **Pending-question persistence across app restart**. Dangling tool call recovery handles this acceptably by surfacing a synthetic error and letting the Cairn re-ask. A future slice could rehydrate the active question card on resume if this turns out to be a friction point.
- **Tool re-entrancy mid-question** (the user sending a freeform prompt while a question is pending, with the prompt automatically becoming a "chat about this" answer). The rpiv package's "Chat about this" escape inspired the Skip button; the deeper "type freeform to redirect" affordance is more product surface than this slice needs.
- **Question-card history** (rendering past, already-answered question bundles as their own chat artifacts). Once a question resolves, only the Cairn's subsequent message reflects the answer. If we later want a visible audit trail of what was asked and chosen, that's a separate UX decision.
- **Authoring the moments where the Cairn should use the tool**. The tool's prompt guidelines suggest *when* to use it, but actively tuning the Cairn persona to reach for grouped questions in specific phases (Scoping pivot points, Slicing scope decisions) is a separate prompt-engineering loop.

## Further Notes

The deadlock-via-`inputQueue` problem is the most subtle part of this slice. It only surfaces under load (a parked tool + a stdin message during the park) and it would be silent — the message would appear queued but never run. The fix is small but architecturally meaningful: it establishes a precedent that some sidecar message types are control-plane (out-of-band) and others are data-plane (queued). If we add another wait-on-user tool later, that distinction should generalize cleanly.

The schema is intentionally permissive of repeated *option labels* across different questions but strict about duplicates *within* one question. This matches user intent: "yes / no" might appear in multiple questions in the same bundle, but "yes / yes" in one question is a bug.

Single-select questions get the "Type your own answer" row by default. This is the right behavior for Cairn's non-technical users — being forced into the Cairn's framing of options is exactly the failure mode the chat-only baseline already has. Multi-select questions deliberately do *not* get a custom-answer row in this slice: the UX of "pick from this list, plus optionally add a freeform one" is genuinely harder to get right (where does the freeform go in the answer array? does the model see it as a selected option?) and isn't load-bearing for any concrete v1 use case.

The pending-resolver pattern is a primitive worth naming. If a future tool needs the same "park until the user does something on the frontend" semantics, the registry module is reusable as-is; what changes is the OutMsg shape and the React surface. Naming it `pending` rather than `ask-user-question-pending` is deliberate.

The tool description is the highest-leverage prose in this slice. The model decides whether to reach for the tool based on that copy. The rpiv package's description is good source material; the Cairn-specific edits should preserve its precision (one short paragraph + a numbered when-to-use list) rather than expanding it.
