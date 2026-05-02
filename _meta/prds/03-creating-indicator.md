# PRD — Slice 03: Creating indicator

## Superseded by Slice 08

This PRD records the historical slice design. Slice 08 and ADR 0005 supersede its generated-HTML artifact assumptions: Brief, Plan, and Tasks are now schema-validated JSON Artifact data, rendered by the app, and task progress is slug-based rather than index-based HTML mutation.

## Problem Statement

The wife finishes scoping. The Cairn has heard enough and goes quiet to write the brief. From her side, the chat shows a `…` for ten, twenty, thirty seconds. Her eyes drift to the panel where she expects the brief to appear — and the panel has been showing the same idle "Your project will show up here as we talk." placeholder it showed when she first opened the app. Nothing about the surface tells her work is happening. The deadest part of the entire scoping experience lives in the gap between *"the Cairn stopped talking"* and *"the brief materialized,"* and right now that gap is empty space wearing a friendly headline.

This is not a generic loading-spinner problem. The wife isn't waiting for a network request — she's waiting for a thoughtful person to put her ideas onto a page. A spinner would lie about that. A status bar in the chat header would be peripheral. What's missing is the same voice she's been talking to, telling her in plain language what it's doing right now, in the place she's already looking.

## Solution

While the Cairn is creating the brief, the project panel speaks in the Cairn's voice. *"Putting your project plan together — give me just a sec."* — written by the Cairn itself, in the same voice, sitting where the placeholder headline used to. The animated lines underneath, which used to stand for nothing, now stand for content actively being made. The moment the brief lands, the message disappears and the brief slideshow takes over.

The chat doesn't go silent either. In the same beat that the panel updates, the Cairn says one short line in the chat — varying the phrasing each time so it doesn't sound canned — so the wife sees the system come alive in two places at once: the chat acknowledging the work, the panel narrating it. When the brief is saved, the Cairn confirms in one short line of chat, doesn't recite what was done, doesn't expose any mechanism. The panel has already updated to the brief itself; the chat just acknowledges the moment.

This generalizes. When slicing lands and the Cairn writes a PRD, the same surface narrates it. When implementing lands and the Cairn ships a feature, the same surface narrates that too. The user-visible moment of "the Cairn is making something for me" looks consistent across the lifetime of every project.

## User Stories

1. As a non-technical user, I want the project panel to tell me what the Cairn is doing while it's putting my brief together, so that the wait doesn't feel dead.
2. As a non-technical user, I want the message in the panel to be in the Cairn's voice — the same voice I've been talking to — not a generic "Loading…" or a list of file operations, so that the experience stays inside one consistent conversation.
3. As a non-technical user, I want the chat to say something brief at the same moment the panel updates, so that I see the system come alive in the place I just typed and in the place the artifact will appear.
4. As a non-technical user, I want the panel message to disappear the instant the brief is ready, replaced by the actual brief, so that the transition from "being made" to "made" is one motion, not two.
5. As a non-technical user, I want the Cairn to confirm in one short line in chat when the brief is saved, without reciting what it did, so that I know it's done without feeling lectured at.
6. As a non-technical user, if the Cairn gets stuck mid-creation and abandons what it was making, I want the panel to stop claiming work is in progress, so that I'm never staring at a stale "putting it together" message.
7. As a non-technical user, if I close the app while the Cairn is mid-creation and reopen it later, I want the panel to show whatever's actually true on disk — empty if no brief exists, the real brief if it does — and not a stuck indicator from a session that already died.
8. As a non-technical user, I want the panel's behavior to feel the same in future phases — when the Cairn writes a PRD, when it ships a feature — so that "the Cairn is making something for me" is one consistent surface across the whole project lifecycle.
9. As the project owner, I want the Cairn — not the sidecar — to be the source of meaning for what appears in the panel, so that the architecture preserves the "single persona voice" contract instead of introducing a second engineer voice that infers status from tool names.
10. As the project owner, I want the indicator to be a tool the persona explicitly invokes (`set_creating`), not a side effect of arbitrary file writes, so that the model is forced to make a deliberate authorial choice about what to tell the user, and so that misuses are visible as wrong messages rather than silent omissions.
11. As the project owner, I want the indicator's `target` parameter to be a constrained enum starting with `"brief"` and growing to include `"prd"`, `"issues"`, etc. as future slices land, so that adding a new artifact type is one enum entry rather than parallel mechanism.
12. As the project owner, I want indicator state to be purely ephemeral — React state only, no on-disk persistence — so that no staleness logic, no migration concern, and no second source of truth has to be maintained.
13. As the project owner, I want the auto-clear logic to live in a deep, isolated module (`useCreatingIndicator`) with its own unit tests, so that the subtle state machine (clear-on-file-change, agent-end fallback, hydrate reset, error reset, last-write-wins on overlap) is verified in isolation rather than tangled inside `App.tsx`'s event listener.
14. As the project owner, I want overlapping `set_creating` calls within a single turn to replace, not stack, so that the latest message wins and there is no "stuck on a stale message" failure mode.
15. As the project owner, I want the persona's bracketing rule (announce-before, confirm-after, for any user-visible artifact) lifted into its own top-level section in the persona prompt rather than inlined per phase, so that slicing and implementing reuse the rule by reference instead of duplicating it.
16. As the project owner, I want the slice to introduce a frontend test runner (Vitest + jsdom + `@testing-library/react`), so that future React work — starting with the project picker UI in the next slice — has a test home and the hook in this slice can be verified before it ships.

## Implementation Decisions

### Modules

- **`set_creating` tool** *(modification to `sidecar/cairn-tools.ts`)*. New `defineTool` entry alongside `set_project_name`. Parameters: `target` (TypeBox `Type.Union([Type.Literal("brief")])` to start), `message` (string). The tool's `execute` invokes a new `onCreatingStart(target, message)` callback supplied by `createGuideTools` options, then returns a one-line confirmation `content` (so the model knows the indicator is up and can proceed). `promptGuidelines` constrain the call: only before user-visible artifact creation, paired with one short line of chat, message phrased in persona voice, no mention of paths/files/tools.

- **Sidecar runtime** *(modification to `sidecar/index.ts`)*. `OutMsg` gains `{ type: "creating_started"; target: "brief"; message: string }`. The `onCreatingStart` callback emits this event over the existing line-delimited JSON stdio. No other protocol changes.

- **`useCreatingIndicator` hook** *(new, deep, in `src/useCreatingIndicator.ts`)*. The single subtle piece of stateful logic in this slice. Pure React hook with no DOM. Inputs:
  - An "event tap" that the App's existing sidecar-event listener calls with normalized signals: `creating_started(target, message)`, `agent_end()`, `hydrate()`, `error()`.
  - A target-content map: `{ brief: string }` derived from the existing `useProjectFile("brief.html")` hook.

  Output: `creating: { target, message } | null`.

  Rules:
  - `creating_started` sets state. If state is already non-null, replace (last-write wins).
  - When the target file's content changes after `creating_started` fires, clear (the success path).
  - `agent_end` clears (fallback for the abandoned-mid-loop case).
  - `hydrate`, `error` clear (defensive resets — neither should occur with creating in flight, but both invalidate any in-flight indicator if they do).

- **App shell** *(modification to `src/App.tsx`)*. Imports the hook, wires the existing sidecar-event listener to the hook's event tap, and consumes `creating`. Conditional rendering inside the existing `panel-placeholder` branch: when `creating` is non-null and no brief slideshow exists yet, the placeholder's `<h2>` shows `creating.message` and the explainer paragraph (`panel-empty`) is omitted. The ghost-line wrapper gets a `panel-placeholder-creating` modifier class. The post-v0 update case (brief already exists, persona calls `set_creating` to update it) is deliberately not handled in this slice — see "Out of Scope."

- **Panel placeholder styles** *(modification to `src/App.css`)*. Adds `.panel-placeholder-creating` modifier rules: a brief text fade-in on the new headline, a tighter `shimmer` animation on the ghost lines (1.6s instead of 2.8s), and a soft `box-shadow` pulse on the `.panel-ghost` wrapper. Two new keyframes (`panel-creating-text-in`, `panel-creating-pulse`).

- **Persona prompt** *(modification to `prompts/persona.md`)*. Adds a new top-level section "When you make something the user can see" after "What you do silently." States the bracketing rule as a carve-out from "most of your work is silent." Two cues before (tool call + matching chat line), one cue after (confirm in chat). Explicitly forbids reciting what was done; explicitly says vary the phrasing. The existing scoping bullet drops the word "silently," references the new section, and keeps every other detail (visual theme, naming flow, `set_project_name`).

### Architectural decisions

The architecture is captured in detail in `_meta/adr/0001-tool-driven-creating-indicator.md`. Summary of the load-bearing choices:

- **Persona-driven, not sidecar-inferred.** The sidecar already observes pi's `tool_execution_start` / `tool_execution_end` events; it could trivially map `Write → "saving your brief"` and emit a synthesized status string. Rejected: that is a second voice — engineer voice — and the persona is supposed to absorb it. The indicator's *meaning* is owned by the model.
- **Indicator lives where the user is looking.** Not the chat-header status pill (peripheral), not a composer indicator (covers the wrong gap, generic). The artifact panel is where attention is during artifact creation; the indicator goes there.
- **Augment-in-place, not banner.** The existing placeholder's headline is swapped for the model's message; ghost lines stay and acquire meaning. No new UI structural element. Cleaner than overlaying a banner on a still-empty panel.
- **Auto-clear, not paired tool.** No `clear_creating`. The frontend's existing `useProjectFile` polling already detects when `brief.html` is written; that signal clears the indicator. `agent_end` is the fallback for the abandoned-mid-loop case. Adds zero new tool surface and no failure mode for "model forgot to call clear."
- **Ephemeral state.** No `<project>/.creating.json`. Chat replay carries the conversational context across reopens; the existing recap-trigger logic handles "the brief is missing, want me to retry?" without needing live indicator state to survive process death.

### Sidecar protocol changes

One new `OutMsg` variant: `{ type: "creating_started"; target: "brief"; message: string }`. Existing events (`hydrate`, `text_delta`, `text_done`, `agent_end`, `error`, `ready`, `active_project`) are unchanged. The frontend's `SidecarEvent` discriminated union gains the same variant, and the existing exhaustiveness check in the listener catches missing handling at compile time.

### Naming flow (unchanged from slice 02)

`set_project_name` continues to fire after the brief is meaningfully drafted. The bracketing rule does *not* apply to `set_project_name` — naming is a conversational moment, not an artifact creation. The persona prompt's existing naming guidance stays as-is.

### Defaults / paths

- Tool name: `set_creating`. Tool label: `Show Creating Indicator`. Lives in the same Cairn-specific tool registry as `set_project_name`.
- Target enum: `["brief"]` in this slice. Future slices extend this with `"prd"`, `"issues"`, etc. — one enum entry per artifact type, no other changes required.
- Message length guidance: under ~80 characters, conversational, no trailing punctuation. Enforced via tool description, not schema (the persona is the constraint, not the sidecar).
- Animation timing: ghost-line shimmer accelerates from 2.8s to 1.6s during creating; soft pulse on the wrapper at 2.4s. Tuned for "alive but not anxious"; revisit during dogfooding if the cadence feels wrong.

## Testing Decisions

A good test for this slice exercises behavior the user can name — *"the panel says what the Cairn is doing while the brief is being made," "the indicator clears the instant the brief lands," "abandoning mid-creation doesn't leave a stuck message"* — not React internals or pi tool dispatch internals.

- **`set_creating` tool, unit (`bun test`).** Extension of `sidecar/tests/cairn-tools.test.ts`. Calling the tool's `execute` with a parsed `{target, message}` invokes the `onCreatingStart` callback exactly once with those args and returns a non-error `content` block. Edge case: target outside the enum is rejected by TypeBox before `execute` runs (covered by pi's existing validation; we don't re-test it).

- **`useCreatingIndicator` hook, unit (`bun test --jsx` via Vitest + jsdom + `@testing-library/react`).** This is the testable deep module the slice exists to extract. Tabular coverage:
  - Initial state is `null`.
  - `creating_started("brief", "msg")` → state is `{target: "brief", message: "msg"}`.
  - Target-file content unchanged after `creating_started` → state persists.
  - Target-file content changes after `creating_started` → state clears.
  - Target-file content changes *before* any `creating_started` (initial poll) → state stays `null` (no spurious clear).
  - `agent_end` after `creating_started` with no file change → state clears (fallback).
  - `hydrate` mid-creating → state clears.
  - `error` mid-creating → state clears.
  - Two `creating_started` calls in sequence → second replaces first (last-write wins).

- **Frontend test runner setup**. Vitest is added as a dev dependency to the root `package.json` (the frontend's package, not the sidecar's). `vite.config.ts` gains a `test` block configuring `environment: "jsdom"`. `@testing-library/react` and `@testing-library/jest-dom` are added for hook + component testing utilities. Test files live colocated with their modules under `src/` with the `.test.ts` / `.test.tsx` suffix. A `bun test:frontend` (or equivalent) script is added to `package.json`.

- **Sidecar protocol smoke, integration (`bun test`).** Extension of the existing protocol smoke (slice 01 prior art at `sidecar/tests/protocol.test.ts`). Spawn sidecar, send `init`, send a synthetic `prompt`, assert that when the model invokes `set_creating` the sidecar emits a `creating_started` event with the parsed target and message *before* any subsequent tool call. Skipped without API key, same gate as the existing smoke.

- **End-to-end smoke, manual.** Open the app on a clean `~/.cairn/`, scope a project to the point where the persona writes the brief. Verify: (1) the panel placeholder headline is replaced by the persona's message at the moment `set_creating` fires; (2) the chat shows a matching short line in the same beat; (3) the indicator clears the instant the brief slideshow renders; (4) reopening the app does not re-show the indicator. Negative case: kill the sidecar mid-creation; reopen; verify the panel shows the empty placeholder, not a stuck indicator from the dead session.

We deliberately do not write:
- **Persona-quality unit tests** for the message text the model produces. Same reasoning as slices 01 and 02 — voice is tuned by reading transcripts, not asserted in tests.
- **Visual regression tests** for the panel CSS. Animation tuning is dogfood-driven; locking pixel-perfect output now would slow iteration.
- **Tauri Rust unit tests for this slice.** Slice 03 does not touch Rust. The principle for future slices: when Rust *is* modified, add Rust tests in `src-tauri/`. Not applicable here.
- **Integration tests for the React component tree** (mounting the full `App` and asserting the panel renders the indicator). The hook tests cover the state machine; the manual smoke covers the integration. A full `App` mount would exercise Tauri runtime detection, sidecar event listening, and resize observers — disproportionate setup for marginal coverage.

Prior art: `sidecar/tests/cairn-tools.test.ts` for the tool extension; `sidecar/tests/protocol.test.ts` for the smoke test pattern. The Vitest setup is new; follow Vite's documented Vitest integration as the canonical reference.

## Out of Scope

- **Banner overlay during artifact updates.** The augment-in-place treatment only covers the placeholder state (no brief yet on disk). When the brief already exists and the persona fires `set_creating` to update it, the iframe stays and no indicator is shown. Acceptable: v0 has only one artifact, scoped once. Banner overlay treatment lands when post-v0 updates become a real flow, or when the second `target` enum entry (`"prd"`, `"issues"`) lands and the panel grows tabs.
- **Composer-area "thinking…" indicator** for between-turn waits. The persona-narrated approach plus the panel indicator covers the high-pain case (artifact creation). Generic between-turn pauses are not the bug we're solving; defer until a real user reports feeling lost during a between-turn wait.
- **Status pill upgrades.** The chat-header status pill (`ready` / `error` / `starting…`) is unchanged. We considered extending it to show a "working…" state and rejected it as peripheral.
- **Persistent on-disk creating state.** No `.creating.json`, no staleness window, no resume-mid-creation recovery. Chat replay + recap-trigger covers the user-visible recovery path; the dead-process case clears naturally because the indicator never persists.
- **Future targets (`"prd"`, `"issues"`).** Defined as future enum entries, but their tool description language, panel rendering, and persona prompt amendments land with the slicing slice. This slice ships only `"brief"`.
- **`clear_creating` tool.** Auto-clear handles every observed case; no need for an explicit clear surface.
- **Vitest workspace integration with `bun test`.** The sidecar's `bun test` and the frontend's Vitest run as separate test commands in this slice. Unifying them under a single `bun test` invocation that dispatches both is a developer-experience improvement, not a slice-03 requirement.

## Further Notes

- **Order of build matters.** Land Vitest setup + the `useCreatingIndicator` hook with its unit tests *first*. Pure logic, no dependency on the sidecar tool or persona prompt — the hook can be merged behind the unused tool surface and verified in isolation. Then the `set_creating` tool extension and sidecar event wiring (gated by the protocol smoke). Then the App.tsx + CSS integration. Persona prompt last, since it's the only piece that activates the feature in user-visible behavior. Each step is independently verifiable.
- **The persona prompt is the single highest-stakes part.** A vague rule means the model forgets to call `set_creating`; an overspecified rule means parroted messages and wooden voice. The Q9 wording lands the carve-out framing ("most of your work is silent — the exception is…") and explicitly omits example messages to avoid parroting. Read transcripts during dogfooding; if the model parrots, tighten. If the model forgets, tighten differently.
- **Regressions are observable by design.** If the persona forgets to call `set_creating`, the user sees the same dead `…` they had before. There is no silent failure mode where the indicator is broken but the surface looks fine. This is intentional — it makes prompt drift detectable.
- **The augment-in-place treatment depends on the placeholder existing.** If we ever change the panel's empty state to render the brief slideshow's frame eagerly with empty content, the `panel-placeholder-creating` rules stop applying and the indicator goes dark. Worth pinning this assumption in `App.tsx` with a one-line comment when the integration lands; revisit if the empty-state design changes.
- **`set_creating` is the second Cairn-specific tool**, after `set_project_name`. Both follow the "thin tool, callback into sidecar runtime" pattern from slice 02. Future Cairn tools (`write_prd`, `write_issue`, `dispatch_subagent`) should follow the same shape. The pattern is now established with two examples and is worth keeping consistent.
- **Risk: model calls `set_creating` for non-artifact work** (e.g., misuses it as a "thinking…" indicator). Tool description forbids it explicitly. Worst case is a weird message in the panel; self-correcting on the next read of transcripts. No defensive code in the sidecar — the constraint is in the prompt.
- **Risk: target file content changes for unrelated reasons** (e.g., the user manually edits `brief.html` during a creating window). Astronomically unlikely in v0; the user has no way to do that from inside the app. Worth knowing about if it ever surfaces; the fix would be a content-hash check at `creating_started` time and only clearing on hash change, but it's premature.
