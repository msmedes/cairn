# PRD — Slice 05: Plan tab and `plan.html` artifact

## Problem Statement

The wife scopes her Project. The Brief lands. She names it. The persona proposes a first chunk to build, she agrees, and the persona narrates *"Putting your plan together…"* — then the panel falls silent while `write-prd` and `write-issue` run silently. When the persona finishes, it confirms in chat: *"Slice one is planned and broken into pieces. Ready to start building when you are."*

She read the chat. The conversation was good. But the panel still shows the same brief slideshow she saw five minutes ago. Nothing in the panel reflects that anything happened. The PRD and issues exist on disk under `.guide/`, but those are engineering scaffolding she's not meant to see. There is **no user-visible artifact for the slicing phase** — the moment of agreement and commitment to a first chunk has no panel manifestation.

This was confirmed in dogfooding: *"the convo is good, I would just like to see some sort of output on the side of the broad implementation steps."* The user came to see her project move forward; the panel showing the unchanged brief during and after slicing fails that.

## Solution

When the user agrees to a slice, the persona quietly writes a small `plan.html` at the Project root — a slideshow in the same shape as the brief, with 2–4 sections in plain language: what's being built first, how it'll come together (in user-readable terms), and what's coming next. The panel grows a tab strip — `Project | Plan` — and on first creation auto-switches to the new Plan tab so the user sees the result without having to hunt for it.

The slicing flow stays narrated as before — the persona brackets `write-prd` and `write-issue` with the existing `set_creating(target="prd"|"issues", …)` calls in user-friendly persona-voiced messages — and adds a third `set_creating(target="plan", …)` bracket immediately before writing `plan.html`. Three creating moments in sequence, each clearing as its artifact lands; the user feels the work happening at three visible beats and ends with a structured page on the Plan tab.

`plan.html` is the user-visible counterpart to the engineering PRD. The PRD remains hidden under `.guide/` for the Guide and sub-agents to read; the Plan is what the user sees. ADR 0003 codifies this distinction.

## User Stories

1. As a non-technical user, after I agree on what to build first, I want a panel surface that reflects what we just decided, so the moment of agreement has visible proof and not just a chat confirmation.
2. As a non-technical user, I want a tab strip on the Project panel so I can navigate between the Brief and the Plan without losing access to either.
3. As a non-technical user, I want the panel to auto-switch to the Plan tab the first time it's created, so I don't have to learn that a tab appeared and hunt for it.
4. As a non-technical user, after that first reveal, I want full control over which tab I'm looking at — the panel never yanks me to a different tab against my intent.
5. As a non-technical user, I want the Plan to be written in the Guide's voice — same plain-language register as the Brief — so the panel feels consistent across artifacts and doesn't suddenly look like an engineering document.
6. As a non-technical user, I want the Plan content to reflect what the persona just told me in chat (the capabilities of the first chunk plus what's coming next), so the panel feels like it's saying what we just agreed on, not a different version.
7. As a non-technical user, before I've gotten to slicing, I want the Plan tab to show a friendly empty-state message rather than be hidden or grayed out, so I understand the tab exists and what will fill it later.
8. As a non-technical user, when I redirect the persona to a different first chunk, I want the Plan tab to update to the new chunk on the next round — but I don't want to be auto-switched to it again, since I already know the affordance.
9. As a non-technical user, I never want to see the PRD or issue files in the panel — those are engineering scaffolding hidden under `.guide/` per ADR 0003.
10. As the project owner, I want `plan.html` written by the persona inline (Write tool, same as `brief.html`) — not via a new skill — because the persona has all the context it needs from the conversation that just produced the slice agreement.
11. As the project owner, I want `plan.html` written *after* `write-issue` succeeds — at the end of the planning sequence — so the Plan reflects what was actually finalized at the engineering layer, and the user sees the Plan land as the climax of the slicing phase.
12. As the project owner, I want `set_creating(target="plan", …)` to bracket the write, so the panel narrates the moment in the persona's voice, the indicator clears when `plan.html` lands, and the Plan tab populates immediately.
13. As the project owner, I want the existing `set_creating(target="prd"|"issues", …)` brackets from slice 04-2 *kept*, with their interpretation clarified in persona.md: those are user-friendly narration of the planning *phase moments*, not engineering-artifact creation. No code changes; persona prompt rewording only.
14. As the project owner, I want `plan.html` at `<project>/plan.html` (project root, parallel to `brief.html`) per ADR 0003's user-visible-artifacts-at-root rule, so the file-system layout encodes the user-visible vs engineering-scaffolding distinction.
15. As the project owner, I want the Plan slideshow to reuse the existing brief slideshow component pointed at `plan.html` instead of `brief.html`, so the frontend change is small and the user's mental model of "the panel shows a structured page" stays consistent.
16. As the project owner, I want re-slicing to overwrite `plan.html` (matching the Brief's regeneration model and slice 04's `plan-history-not-versioned` decision), so there is exactly one canonical Plan on disk and Implementing has no ambiguity about which is live.
17. As the project owner, I want the tab strip component to be a small reusable piece — not a one-off — so future tabs (`Building` for Implementing, etc.) can plug into the same surface without reinventing it.

## Implementation Decisions

### Modules

- **Tab strip component** *(new, in `src/PanelTabs.tsx`)*. A small React component that renders a row of tab buttons above the panel card. Inputs: a list of tabs (`{ key, label, available }`), the active tab key, and an `onSelect` callback. Output: a row of buttons with the active tab styled distinctly. The "Project" pill in the existing layout becomes the first tab; "Plan" becomes the second. Future tabs (e.g., "Building") slot in by extending the input list.

- **`useActivePanelTab` hook** *(new, in `src/useActivePanelTab.ts`)*. Manages active-tab state with two responsibilities: (a) holds the active tab as React state; (b) auto-switches to the Plan tab on the *first* observed transition from "no `plan.html`" to "`plan.html` exists." After that first auto-switch, the user controls tab selection via clicks. Inputs: `planExists: boolean` (derived from `useProjectFile("plan.html")`). Output: `{ activeTab, setActiveTab }`. The "first auto-switch only" rule is encoded by tracking a `hasAutoSwitchedRef` that flips true on the first auto-switch and never flips back within a session.

- **`useProjectFile("plan.html")`** *(reuse)*. Same hook the brief uses; pointed at `plan.html`. Returns the file's contents (or `null`) and updates on file-system changes via the existing polling mechanism.

- **Panel rendering in `App.tsx`** *(modification)*. Where the existing brief slideshow renders, conditionally render either the brief (Project tab active) or the plan (Plan tab active). Both reuse the existing slideshow component; only the source HTML differs. The Plan tab's empty state — when `plan.html` doesn't exist yet — renders a friendly message in the panel ("Once we agree on what to build first, the plan will show up here.") in place of the slideshow. The existing `useCreatingIndicator` rendering continues to overlay during `set_creating` brackets.

- **Slideshow component** *(reuse, no changes)*. The existing component that parses `brief.html`'s structure and renders left index + right detail accepts an HTML string; it's source-agnostic. Pointing it at `plan.html` works without modification. If `plan.html`'s structural shape diverges from brief's (e.g., different section nesting), the slideshow is permissive enough; we revisit only if dogfooding surfaces a parsing mismatch.

- **`set_creating` tool extension** *(modification to `sidecar/guide-tools.ts`)*. The `target` parameter union extends from `"brief" | "prd" | "issues"` to add `"plan"`. The `OutMsg.creating_started.target` in `sidecar/index.ts` matches. The `useCreatingIndicator` target-content map gains `plan` (watches `<project>/plan.html`); auto-clear fires when `plan.html` content changes. Same shape as slice 04-2's `prd` and `issues` extensions.

- **Persona prompt** *(modification to `prompts/persona.md`)*. The Slicing bullet under "Your job" gains a new step at the end of the planning sequence: after `write-issue` completes, the persona calls `set_creating(target="plan", <message>)`, writes `plan.html` at the project root via the Write tool, and confirms in chat. The plan content guidance: 2–4 sections in plain language — *what we're building first*, *how* (broad steps, not engineering tasks), *what's coming next*. Same Kanagawa visual theme as the brief; same self-contained inline-styled HTML structure (left index, right detail).

  The Slicing bullet also gains a clarification: the existing `set_creating(target="prd"|"issues", …)` brackets are user-friendly narration of the planning **phase moments** (e.g., *"Putting your plan together…"*, *"Now breaking it into pieces…"*), not engineering-artifact narration. The persona never names "PRD" or "issues" in user-facing messages. ADR 0003 codifies why.

- **`prompts/persona.md` "What you do silently" section** *(modification)*. The existing line *"The PRD or issues files unless they ask to see them"* stays; an explicit reference to `plan.html` is added to the *user-visible* category to balance the framing.

### Architectural decisions

The architecture is captured in detail in `_meta/adr/0003-user-visible-vs-engineering-scaffolding.md`. Summary of the load-bearing choices:

- **`plan.html` is a user-visible artifact at project root.** Parallel to `brief.html`. Under ADR 0003, project root holds user-visible artifacts; `.guide/` holds engineering scaffolding. The path encodes the distinction.

- **Persona writes `plan.html` inline (no skill).** Mirrors `brief.html`. The persona has all the context it needs from the conversation that just produced the slice agreement; the just-written PRD and issues are also available if the persona wants to consult them. A separate `write-plan-html` skill would add infrastructure without gaining quality, since the work is "persist the plain-language summary the persona is already composing."

- **Plan is written *after* `write-issue` succeeds.** "Planning" is one atomic user-observable event; `plan.html` is its completion artifact. Writing it before `write-prd` would mean the plan reflects only what the persona said in chat; writing it after `write-issue` lets the plan reflect what was actually finalized at the engineering layer. Symmetry with the brief flow: one bracket → silent work → user-visible artifact appears → confirmation.

- **Tab strip on the panel, not a card-below.** Confirmed via dogfooding feedback ("should be a separate tab the user can click"). One card below the brief was rejected as visual clutter; a separate tab keeps each artifact's view focused and leaves room for future tabs (Building during Implementing, etc.).

- **Auto-switch on first creation only.** Per Q8 grilling: continuity with the brief reveal experience (the brief just *appears*; the plan should too), first-time discoverability of the new tab, and respect for user navigation after the first switch. Re-slicing overwrites `plan.html` but does not auto-switch.

- **`set_creating(target="prd"|"issues")` brackets are kept, framing clarified.** Per slice 05 grilling and dogfooding feedback, the existing brackets are user-friendly narration of the planning phase moments, not engineering-artifact creation. No code change; persona prompt clarifies the framing.

### Sidecar protocol changes

The `creating_started` event payload's `target` widens from `"brief" | "prd" | "issues"` to `"brief" | "prd" | "issues" | "plan"`. The frontend's `SidecarEvent` discriminated union gains the same variant; the existing exhaustiveness check on the listener catches missing handling at compile time. No new event types; no changes to `init` / `prompt` request handling.

### Defaults / paths

- `plan.html` lives at `<project>/plan.html`. Same parent as `brief.html`.
- `set_creating` target: `"plan"` (new), watch target = `<project>/plan.html`.
- Tab keys: `"project"` (renders `brief.html`), `"plan"` (renders `plan.html`). Future: `"building"`.
- Empty-state copy for the Plan tab: *"Once we agree on what to build first, the plan will show up here."* — overridable later via the persona, but a tasteful default sits in `App.tsx`.
- Plan content guidance (in persona prompt): 2–4 sections; first section *"What we're building first"* (the slice's capabilities); middle sections *"How"* (broad steps in plain language); final section *"What's coming next"* (forward look). Same Kanagawa theme as brief.

## Testing Decisions

A good test for this slice exercises behavior the user can name — *"the panel grows a Plan tab when the slicing phase finishes," "the Plan tab populates with a slideshow about the first chunk in plain language," "the panel auto-switches to Plan the first time the plan exists, but not on regeneration"* — not React internals or pi tool dispatch internals.

- **`useActivePanelTab` hook, unit (Vitest).** Tabular coverage:
  - Initial state with no `plan.html` → active tab is `"project"`.
  - `plan.html` appears (transition `null` → content) → active tab transitions to `"plan"`, ref flips true.
  - User clicks `Project` after auto-switch → active tab is `"project"`, no further auto-switches.
  - `plan.html` content changes (regeneration) after auto-switch ref is set → active tab stays at user's last selection (no auto-switch on update).
  - `plan.html` removed (e.g., user redirects mid-slice and slate is cleared) → active tab stays where it was; ref unchanged (we do not "re-arm" auto-switch).

- **`set_creating` enum extension, unit (`bun test`).** Extension of `sidecar/tests/guide-tools.test.ts`. Confirm the tool accepts `target: "plan"` and rejects an unknown value (TypeBox covers this; spot-test the new variant). Confirm the `creating_started` callback receives `"plan"` verbatim.

- **`useCreatingIndicator` extension, unit (Vitest).** Extension of `src/useCreatingIndicator.test.ts`. Tabular coverage: `creating_started("plan", ...)` clears when `plan.html` content changes; `agent_end` fallback for `plan` target; mixed-target overlap-replacement (e.g., `creating_started("issues", ...)` followed immediately by `creating_started("plan", ...)`).

- **Tab-strip component, unit (Vitest + @testing-library/react).** Renders the active tab styled distinctly; `onSelect` fires with the clicked key; tabs with `available: false` (future-proofing for Building tab) render disabled.

- **End-to-end smoke, manual.** Open the app on a clean `~/.guide/`. Scope a project. Verify:
  1. Brief lands; Plan tab visible in the strip with empty-state copy ("Once we agree…").
  2. Click Plan tab — empty state renders, no error, no spinner stuck.
  3. Agree on a slice. Three `set_creating` brackets fire in sequence (`prd`, `issues`, `plan`); panel narrates each in persona voice.
  4. `plan.html` lands. Indicator clears. Panel auto-switches to Plan tab (first creation). Slideshow renders 2–4 sections in plain language.
  5. Click back to Project tab — brief still renders unchanged.
  6. Tell the persona "actually, can we start with X instead?" — Plan tab updates to the new content but does *not* auto-switch (already creation has happened); user stays where they were.

- **Sidecar protocol smoke (`bun test`).** Extension of `sidecar/tests/protocol.test.ts`. Spawn sidecar, send a synthetic `prompt`, assert that when the model fires `set_creating(target="plan", …)` the `creating_started` event payload's target is `"plan"`. Skipped without API key, same gate as existing smoke.

We deliberately do not write:

- **`plan.html` content schema validation.** The persona writes the file in their voice; testing the markup or section count would lock-in the persona's structural choices and slow iteration. Quality is calibrated by reading transcripts and the resulting plans during dogfooding.
- **Persona-prompt voice tests** for the plan's wording. Same reasoning as slices 01–04: voice is tuned by reading transcripts, not asserted in tests.
- **Visual regression tests** for the Plan tab's slideshow. Reuses the brief slideshow component, which doesn't have visual regression tests either; covered by manual smoke.
- **Persistence of `useActivePanelTab`'s `hasAutoSwitchedRef` across reopens.** Per the "auto-switch on first creation per *session*, not per *project*" sub-call from grilling: a session reopen of a project that already has `plan.html` renders the Project tab by default, and the user navigates manually if they want the plan. No on-disk state needed.
- **Multi-window or multi-project tab-state isolation tests.** v0/v1 has one Project per Session and effectively single-window operation (Tauri); revisit when those constraints change.

Prior art: `src/useCreatingIndicator.test.ts` for the hook test pattern; `sidecar/tests/guide-tools.test.ts` for the tool extension; the brief slideshow's existing render path in `App.tsx` for the panel integration shape.

## Out of Scope

- **Building tab.** The third tab (live status during Implementing) is a separate slice that lands when Implementing's design is real. PRD 05 ships only `Project | Plan`. The tab strip component is built to extend cleanly.
- **PRD/issue surfacing.** Engineering scaffolding stays under `.guide/` per ADR 0003. No "show me the PRD" affordance, no "view issues" panel. The persona translates sections in chat if the user explicitly asks; that conversational behavior is unchanged.
- **Plan history / versioning.** Re-slicing overwrites `plan.html`; no `01a` / `01b` / archived plans. Matches slice 04's overwrite call. v2+ concern.
- **Persona-driven empty-state copy.** The empty Plan tab copy is a static default string in `App.tsx`. Letting the persona dynamically write the empty-state message (e.g., context-aware: "We just finished the brief — once we figure out where to start, the plan will show up here.") is a future enhancement; not in v1.
- **Slideshow component evolution.** If the Plan's content shape diverges meaningfully from brief's (e.g., it wants a progress indicator, a "current section" highlight, a different visual language), that lands in a follow-up slice. v1 reuses the brief slideshow as-is.
- **Cross-tab indicator placement nuance.** Where the `set_creating` indicator renders when the user is on a tab whose target file isn't being created (e.g., user is on Plan tab while `set_creating(target="prd")` is firing) — handled implicitly by rendering on the active tab and falling through to whatever placeholder is there. If dogfooding surfaces an awkward case (e.g., the user can't see the indicator at all because they switched tabs mid-bracket), we revisit; not designed for v1.
- **Dropping `set_creating(target="prd"|"issues")` from slice 04-2.** Considered during grilling and rejected on dogfooding feedback. Stays as-is; only persona-prompt framing is clarified.

## Further Notes

- **Order of build matters.** Land the Plan-tab plumbing first (the tab-strip component, `useActivePanelTab` hook with unit tests, App.tsx integration with empty-state) — that's pure frontend, no behavior change yet because no `plan.html` is being written. Then land `set_creating(target="plan")` enum extension (sidecar + frontend hook updates with unit tests) — still no behavior change because the persona isn't using it. Then land the persona prompt update that makes the persona actually write `plan.html` — this is the activation step. Each step is independently demoable.

- **The persona prompt addition is the highest-stakes part of this slice.** Specifies *when* to write `plan.html` (after `write-issue` succeeds), *how* (Write tool with set_creating bracket), and *what* (2–4 sections in persona voice, Kanagawa theme, plain language). Voice and section structure are tuned by reading the resulting plans during dogfooding. If the persona starts producing engineer-y plans, tighten the prompt; if it parrots, soften it.

- **The Plan tab's auto-switch is a small but high-leverage UX moment.** The first time the user agrees on a slice, the tab strip lights up and the panel reveals the new content. Get the timing right: auto-switch happens *as the indicator clears and `plan.html` content lands*, not before (jarring) and not after (the user thinks nothing happened). The hook's transition detection handles this — covered by unit tests, verified by manual smoke.

- **`set_creating` target enum is now four-wide.** Future user-visible artifacts (when Implementing produces them) extend the enum in the same shape; engineering scaffolding does not get target entries (per ADR 0003).

- **Risk: the persona writes `plan.html` to a wrong path.** The persona prompt instructs the project-root location. If the persona drifts (e.g., writes to `.guide/plan.html` or `<project>/plans/01.html`), the watch in `useCreatingIndicator` doesn't fire, the indicator stays up, and the Plan tab stays empty until `agent_end` clears it. Observable failure mode (the indicator gets stuck, then clears with no result), which is the right shape — surfaces drift loudly rather than silently. Mitigation: tighten persona prompt language if drift is observed; no defensive code in the sidecar.

- **Risk: the Plan tab's empty-state copy gets stale relative to the persona's voice.** A static string in `App.tsx` doesn't adapt. If "Once we agree on what to build first" stops landing well, swap the string. If it becomes a recurring problem, promote to persona-driven (v2+).

- **CONTEXT.md updates** alongside this PRD introduce `Plan` and `Engineering scaffolding` as canonical terms and correct the `User-visible artifact` entry. ADR 0003 is the architectural anchor; this PRD is the first slice that applies its rules.
