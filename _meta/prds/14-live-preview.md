# PRD — Slice 14: Live preview

## Problem Statement

The user is in Implementing. The Cairn — through sub-agents and the bash tooling beneath them — has gotten the project running. There's an HTTP service listening on some localhost port right now, ready to render the thing the user has been describing for the last twenty minutes. From the user's side: nothing visible. The chat says some variant of "your app is running" but they have no idea how to reach it, what URL to type, or what "localhost" means. The single most exciting moment in the whole Cairn lifecycle — *the thing they wanted is alive* — is invisible.

This is the gap between *"the Cairn finished building it"* and *"the user can see it."* Today the gap is empty. The user has to ask. They don't always know to ask. They certainly shouldn't have to.

## Solution

A small pill appears at the right end of the project panel's tabs row whenever the Cairn has something runnable to show the user. The pill is labeled in the Cairn's voice — *"Your recipe finder"*, *"Your family scheduler"* — with a small external-link icon to the right communicating that clicking sends them somewhere. Click → the user's system default browser opens directly to the actual URL. No URL is visible on the pill itself. No status dot. No "localhost:3000" leak.

The pill replaces itself silently when the Cairn moves the running app to a new URL or replaces it with a different one. It never explicitly clears via a tool: there is no `clear_live_preview`. If the running app dies and the user clicks the pill, the browser shows its familiar "can't connect" error; the user reports it to the Cairn ("hey, where's the app?"), the Cairn restarts and re-declares. Stale-on-click is a feature: it produces a useful conversational signal rather than a silent inconsistency. The pill vanishes only on project switch and on app restart.

## User Stories

1. As a non-technical user, I want a visible, clickable shortcut to my running app at the top of the project panel, so I can see what's been built without learning what "localhost" means.
2. As a non-technical user, I want the shortcut labeled in plain language ("Your recipe finder") rather than as a URL, so I never have to read technical text to know what I'm about to click.
3. As a non-technical user, I want a small external-link icon on the shortcut, so I know clicking sends me to my browser before I commit to it.
4. As a non-technical user, I want clicking the shortcut to open my familiar default browser — not a new window inside Cairn — so I'm using a browser I already trust and understand.
5. As a non-technical user, when the Cairn moves my running app to a new URL (server moved ports, new app spun up), I want the shortcut to update silently without drawing my attention, so it feels like a stable affordance rather than a notification.
6. As a non-technical user, when the running app has died and I click the shortcut, I want a clear browser-level "can't connect" error I can show the Cairn, so I can recover by asking naturally instead of figuring out a hidden state.
7. As a non-technical user, when I switch to a different project, I want the previous project's shortcut to vanish, so the pill on screen always belongs to the project I'm currently looking at.
8. As a non-technical user, when I close Cairn and reopen it tomorrow, I want the shortcut to start empty, so I'm never staring at a link to a long-dead process from yesterday's session.
9. As the project owner, I want the pill set by the Cairn persona itself through an explicit tool call (`set_live_preview`), not auto-detected from process state, so the architecture preserves the single-voice contract and the model's intent is what reaches the user.
10. As the project owner, I want the tool to be set-only with no `clear_live_preview` counterpart, so the model never maintains implicit "should I clear?" state and the only failure mode is a stale URL that surfaces through normal conversation.
11. As the project owner, I want the tool granted to the Cairn persona only, never to sub-agents, so CONTEXT.md's "Sub-agents are silent and invisible" invariant continues to hold; sub-agents report URLs via `task_outcome.message` and the persona reads and sets.
12. As the project owner, I want pill state purely ephemeral and in-memory, with project-switch as the only non-tool clear, so there is no on-disk file to keep in sync with an actual process lifecycle Cairn does not control.
13. As the project owner, I want the auto-clear-on-project-switch logic isolated in a deep `useLivePreview` hook, so the rule "set replaces, hydrate clears" is verified in unit tests rather than tangled into `App.tsx`.
14. As the project owner, I want the pill rendered by a thin pure component taking `{ url, label } | null` and an `onClick` handler, so the visual treatment is testable independently of the sidecar plumbing.
15. As the project owner, I want the tool's parameters schema-validated (URL via `z.string().url()`, label via `z.string().min(1).max(80)`), so a malformed input from the model fails at the tool boundary with structured feedback rather than reaching the click handler as a broken `href`.
16. As the project owner, I want the tool to be runtime-agnostic — it accepts a URL string and nothing more — so adding a project type (Python, Go, static site, future others) requires zero changes to this slice.

## Implementation Decisions

### Modules

- **`set_live_preview` tool** *(addition to the existing Cairn tools module)*. New `defineTool` entry alongside `set_creating`. Parameters: `url` (`z.string().url()`) and `label` (`z.string().min(1).max(80)`). The tool's `execute` invokes a new `onLivePreviewSet(url, label)` callback supplied via `CairnToolsOptions`, then returns a one-line confirmation. `promptGuidelines` constrain the call: only with evidence the URL responds (typically a sub-agent's `task_outcome.message`), Cairn-voice label, no technical terms, re-call to update, no clear tool exists, stale chips become conversational signals.

- **Sidecar runtime wiring** *(modification to the sidecar entry module)*. Wires `onLivePreviewSet` to emit a new `live_preview_set` event over the existing line-delimited JSON stdio. No other protocol changes.

- **Wire-protocol type** *(addition to the shared protocol messages module)*. New `SidecarOutMsg` variant: `{ type: "live_preview_set"; url: string; label: string }`. Frontend's existing exhaustiveness check catches missing handling at compile time. No `SidecarInMsg` change — the model never sends "clear" or any other inbound signal related to the chip.

- **`useSidecarSession` integration** *(modification)*. Accepts a new `onLivePreviewSet(url, label): void` callback prop. Routes the new event to it. No other changes.

- **`useLivePreview` hook** *(new, deep, in the shell feature)*. The single piece of subtle stateful logic in the slice. Pure React hook, no DOM. Inputs: event taps `live_preview_set(url, label)`, `hydrate()`, `error()`. Output: `livePreview: { url, label } | null`. Rules:
  - `set` from any prior state replaces (last-write wins).
  - `hydrate` clears (the project-switch invariant — same trigger that already clears the creating indicator).
  - `error` clears defensively.
  - There is deliberately no `agent_end` handler — the pill is sticky across turns, unlike the creating indicator which auto-clears at turn end.

- **`LivePreviewChip` component** *(new, in the shell feature)*. Pure render: takes `livePreview: { url, label } | null` and `onClick: (url: string) => void`. Returns the pill or null. Visual: `rounded-full`, `min-h-10` to match the existing tab pills, `outline outline-1 outline-[var(--border)]`, transparent background lifting to `color-mix(in_srgb,var(--muted)_56%,transparent)` on hover (mirrors tab-hover styling). Label text `text-sm font-medium text-foreground`. Small external-link glyph on the right, 12px, `text-muted-foreground`. URL exposed only via `title` attribute for hover discovery. Entry animation reuses the existing `panel-creating-text-in` keyframe; the label crossfades on URL/label replacement (no full chip remount, so the update doesn't read as a notification).

- **`PanelTabs` integration** *(modification to the tabs component)*. Receives the chip render slot and positions it with `ml-auto` inside the existing flex row.

- **App shell integration** *(modification to the top-level App)*. Calls `useLivePreview`, threads its event taps into `useSidecarSession` callbacks alongside the existing creating-indicator callbacks. Passes the resulting `livePreview` state through `ProjectPanel` into `PanelTabs`. The chip's `onClick` calls `openUrl(url)` via `@tauri-apps/plugin-opener`, which is already imported for the existing repo-link feature.

- **Persona prompt** *(modification to the persona prompt)*. Adds a short section describing when to call `set_live_preview`: only with evidence the URL responds, Cairn-voice label, no technical leak, re-call to update, no clear tool exists, stale chips are intentional conversational signals.

### Architectural decisions

- **Persona-driven, not sidecar-inferred.** The sidecar does not inspect child processes, listen on ports, or guess what URLs are running. The persona declares; the pill displays. Same single-voice principle as the creating indicator (ADR 0001).

- **Runtime-agnostic.** The tool takes a URL string — nothing about it commits Cairn to bun, Node, Vite, Python, Go, or any future runtime. The model and sub-agents decide how to run the project; the pill shows where the result lives.

- **Set-only, no clear.** No `clear_live_preview` counterpart. Rationale: a clear tool forces the model to maintain implicit state ("is the chip up? should I take it down?") — exactly the kind of LLM-hostile state-tracking that produces stale or missed calls. A discriminated-union schema (single tool with nullable URL representing both set and clear) has the same flaw: the model has to construct two different shapes from one schema and decide which it's in. Two separate tools (set + clear) is the cleanest formalism but it imports the same state problem one level up. Choosing set-only removes the dilemma entirely: the model has exactly one decision — "is there a URL worth showing?" — and the only failure mode (stale URL → click → browser error) becomes a useful conversational signal. Project-switch handles the only mandatory clear case, in React, not in the model.

- **Ephemeral, in-memory only.** No persisted file. The URL points at a process; the process doesn't survive app restart; persisting the URL would outlive the truth it claims. On reopen, the persona re-declares as part of natural recap.

- **Single-slot.** One pill at a time. Multi-slot is a future backward-compatible extension (optional `id`); single-slot matches the user's mental model and keeps the persona from surfacing implementation-detail endpoints (admin panels, internal APIs) alongside the front door.

- **Persona-only tool.** Registered with `createCairnTools` alongside `create_brief_artifact` and `set_creating`. Sub-agents launched via `spawn_subagent` do not receive it. Sub-agents that start a server report the URL via `task_outcome.message`; the persona reads and sets. Preserves CONTEXT.md's "Sub-agents are silent and invisible" invariant.

- **System browser, not embedded webview.** Click target is `openUrl(url)` via `@tauri-apps/plugin-opener`. An embedded Tauri webview is explicitly deferred — the "Preview tab" direction CONTEXT.md hints at with "eventually the app itself" as the final User-visible artifact is a separate slice.

- **No status states beyond "set" and "absent".** No `starting`, no `running`, no `stopped` chip variants. The model conveys those via chat. The pill is a clickable affordance, not a status display.

### CONTEXT.md

Already updated in the preparatory commit landed in this slice's design phase. "Live preview" appears under Language and under Relationships. No further glossary work needed during implementation.

## Testing Decisions

A good test for this slice exercises external behavior — what the model does, what the React surface shows — not internal wiring. The behaviors that matter are concentrated in two units:

- **`useLivePreview` hook unit tests.** Verify: (1) `set` from null sets the chip; (2) `set` from non-null replaces (last-write wins); (3) `hydrate` clears regardless of prior state; (4) `error` clears defensively; (5) no `agent_end` clearing — the pill is sticky across turns, distinguishing it from the creating indicator. Prior art: the existing `useCreatingIndicator` hook tests. Same testing shape, simpler state machine (no content-change-derived auto-clear).

- **`set_live_preview` tool unit tests.** Verify: (1) valid params invoke the `onLivePreviewSet` callback exactly once with the URL and label; (2) malformed URL (Zod `.url()` failure) is rejected at the tool boundary and returns a structured error without invoking the callback; (3) empty label rejected; (4) label longer than 80 chars rejected. Prior art: the existing Cairn tools test suite.

- **`LivePreviewChip` component** is covered by App-level integration in the existing App test file rather than its own. The component is pure render with no internal state; the worthwhile test is "the pill appears in the panel when the hook is non-null and clicking it invokes `openUrl`," which is integration-shaped.

Tests deliberately *not* written:
- No test asserts the pill clears on actual process death — Cairn does not track processes, deliberately out of scope.
- No test verifies the URL is reachable — no fetch, no health check, no liveness probe.
- No test of the system-browser open behavior beyond confirming `openUrl` is the click handler; the Tauri plugin is the source of truth.
- No persona prompt assertion test for "calls `set_live_preview` at the right time" — prompt behavior is exercised by the existing live-prompt evals, not unit tests.

## Out of Scope

- **Embedded webview / in-Cairn preview panel.** The "Preview tab" direction CONTEXT.md hints at ("eventually the app itself" as User-visible artifact) is a separate slice. This slice ships the pill; the embedded panel is its successor.
- **Process lifecycle tracking.** Cairn does not own the running process — it does not spawn it, monitor it, or kill it. Sub-agents may spawn dev servers via `pi-coding-agent`'s bash tool, but those die when the sub-agent's turn ends. Surfacing a *persistent* server is the user's project's concern, not Cairn's.
- **URL liveness verification.** No HTTP poll, no health check. The pill is honest by virtue of the model's discipline; staleness is recovered conversationally.
- **Multi-slot.** One pill at a time. Backward-compatible extension if multi-slot is ever needed.
- **User-driven dismiss / × button.** Adds a "dismissed-but-model-still-has-it" state with no clean resolution. Conversational recovery is the dismiss path.
- **`clear_live_preview` tool.** See above — set-only is deliberate.
- **Sub-agent direct tool access.** Sub-agents report URLs via `task_outcome.message`; persona sets.
- **Status states (`starting`, `stopped`, `errored`).** Model conveys those via chat.
- **Persona-voice translation in the React layer.** Model passes `label` already in Cairn voice; the pill renders it verbatim.

## Further Notes

- **Sequencing dependency**: persona-only access is enforced by wiring (which tools `createCairnTools` returns to which consumer), not by per-tool validation. If a future change passes the full tool set into a sub-agent's tool roster, the silent-sub-agents invariant breaks silently. A code comment at the tool definition referencing this PRD is worth including.

- **Replacement animation is deliberately understated.** A label crossfade on URL/label change — not a full chip remount. Remounting on every update would read as a notification, working against the pill's purpose (a persistent affordance, not a status banner).

- **CONTEXT.md term landed early.** The "Live preview" entry was added before this slice's implementation begins, so the persona prompt and any sub-agent prompts referencing the term have it available from the first commit.

- **Possible future ADR.** The "set-only / no clear / conversational error recovery" principle is non-obvious and reusable. If a similar pattern recurs (a "command running" pill, a "deploy status" pill), an ADR capturing the principle becomes worthwhile. Skipped now as borderline — captured here in this PRD as the primary record.

- **Risk: wrong-but-plausible label.** The model can produce a Cairn-voice label that reads natural but misnames the project ("Your recipe finder" when the user is building a meal planner). The 80-char limit and the Cairn-voice prompt rule mitigate but don't eliminate this. Worst case: confusing label, user asks, persona re-sets. Acceptable failure mode given the alternative (no label, or technical URL) is strictly worse.
