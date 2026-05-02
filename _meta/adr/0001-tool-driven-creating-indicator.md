# Tool-driven creating indicator on the project panel

## Status

Accepted.

## Context

While the persona is generating a user-visible artifact, there is a long silent gap during which the chat shows only `…` and the project panel shows the same idle placeholder it has shown all along. The gap is the deadest part of the wait — the user's attention has shifted to the panel, expecting the artifact to materialize, and the UI is giving them no signal that anything is happening. Persona narration alone (e.g., "putting your project plan together…") helps, but only covers the in-chat half of the wait; the inter-turn silence while the artifact is being created remains visually dead.

## Decision

The persona declares panel state through a custom Cairn tool: `set_creating({ target, message })`. The sidecar receives the tool call and emits a typed `creating_started` event over the existing stdio protocol. The frontend swaps the placeholder headline for the model's message and tightens the ghost-line animation, then auto-clears the indicator the moment the target artifact content changes (via the existing `useProjectFile` polling hook), with `agent_end` as a fallback for the case where the persona fired the tool but the artifact never landed. The persona prompt has a top-level "When you make something the user can see" section that requires bracketing every user-visible artifact with this tool call **and** a matching short line in chat, then a confirmation line when the artifact is done.

## Considered alternatives

- **Persona narration alone, no panel indicator.** Rejected: the persona's "give me a sec" line lives in chat, but the user's attention drifts to the panel during the wait. Words in the wrong place. Also fails for waits long enough that "a sec" stops feeling true.
- **Sidecar synthesizes a status string from raw tool events.** The sidecar already observes pi's `tool_execution_start` / `tool_execution_end`; it could map `Write` → "saving your brief" and emit a status event. Rejected: this introduces a *second voice* — the engineer voice the persona is supposed to absorb — making decisions about what to show the user. The persona is the only voice; the sidecar plumbs through what the persona declares, not what the sidecar infers.
- **Status pill in the chat header.** The header already has a `ready` / `error` pill. Extending it to "working…" is the cheapest possible change. Rejected: the pill is peripheral. During artifact creation the user is staring at the panel where the artifact will appear, not at a corner of the chat header.
- **Composer-area "thinking…" indicator** (auto, on `sending=true`). Rejected: redundant with persona narration for the cases that matter, and generic — it doesn't speak the persona's voice. Defer until a real user reports feeling lost during a class-2 (between-turn) wait.
- **Persistent on-disk creating state** (e.g., `<project>/.creating.json`) so the indicator survives crashes mid-generation. Rejected: the chat replay already shows the "putting your brief together…" message, and the persona's existing recap-trigger logic handles "the brief is missing, want me to retry?" without needing live state to survive a process death.

## Consequences

- **Regressions are visible.** If the persona forgets to call `set_creating` for a future artifact, the user sees the same dead `…` they had before. There is no silent failure — observable behavior tells us when the prompt rule is slipping.
- **Future artifacts extend the same surface.** `write_prd` and `write_issue` (slicing phase) add new entries to the `target` enum rather than introducing parallel mechanisms. The bracketing rule in the persona prompt already covers them by design.
- **The persona is responsible for both channels at once.** A tool call without a matching chat line, or vice versa, is a prompt-discipline failure. We accept this fragility because the alternative (sidecar-inferred status) violates the architectural constraint that the persona is the only voice. Mitigation is observation against transcripts and tightening the prompt wording when drift appears.
- **Panel indicator is purely ephemeral** — React state only, no on-disk persistence. On reopen, the panel renders whatever is true on disk. The chat replay carries the conversational context; the recap-trigger flow handles missing artifacts.
