# PRD — Slice 06: Implementing-phase orchestration

## Superseded by Slice 08

This PRD records the historical slice design. Slice 08 and ADR 0005 supersede its generated-HTML artifact assumptions: Brief, Plan, and Tasks are now schema-validated JSON Artifact data, rendered by the app, and task progress is slug-based rather than index-based HTML mutation.

## Problem Statement

Slicing produces a Plan, a PRD, and a set of issues, but nothing in Guide currently turns those issues into working code. The persona prompt has one sentence on Implementing — *"sub-agents do the actual coding while the Guide narrates"* — and no concrete dispatch mechanics. A user who agrees to a Plan today has no path forward inside Guide; the Plan tab just sits there. From the user's perspective the project visibly stalls at the moment they were promised software.

The shape of the missing phase is not obvious. It needs to honor the persona's contract (single voice, never claim something works without evidence, redirect-anytime), produce visible progress for the user without exposing engineering vocabulary, handle sub-agent failures honestly, gate slice-done on real verification, and resume cleanly across app restarts. ADR 0004 settles those questions; this slice implements them.

## Solution

When the user confirms the Plan, the Guide asks a short go-ahead question — *"Want me to start on this?"* — and on agreement, a new Tasks tab appears in the project panel with the Plan's pieces as a plain-language checklist, all unchecked. The Guide quietly works through them one at a time, narrating one short line per piece in chat (*"now working on the first piece"*, *"got that one"*) and ticking each box as the work lands. If something gets stuck, the Guide says so in plain language and offers options instead of staying silent. When every box is ticked, the Guide silently checks that the slice as a whole still builds, then invites the user to try it: *"the pieces are in place — give it a try and let me know how it feels."* If the user closes the app mid-slice and comes back later, the Guide picks up with a short recap and waits for their nod before continuing.

What the user does not see: code, errors, stack traces, tool output, file paths, or anything about how the work is being done.

## User Stories

1. As a non-technical user, I want a clear *"ready to start?"* moment after the Plan is written, so that I know execution is about to begin and can pause to read the Plan first.

2. As a non-technical user, I want a Tasks tab that shows the Plan's pieces as a plain-language checklist, so that I have a visible, predictable progress surface during the slow part of the project.

3. As a non-technical user, I want each piece to tick off as it's built, so that I have evidence the work is real without having to ask.

4. As a non-technical user, I want the Guide to say one short thing in chat per piece (start, finish), so that the chat surface stays alive without becoming noisy.

5. As a non-technical user, I want the Guide to tell me when it's retrying a piece, in plain language, so that I'm not staring at a silent panel wondering if anything is happening.

6. As a non-technical user, I want the Guide to stop and offer options when it actually gets stuck, so that I can intervene with intent instead of guessing whether to wait.

7. As a non-technical user, I want the Guide to never claim the slice is *"done"* before I've tried it, so that the word *"working"* keeps meaning something.

8. As a non-technical user, I want the Guide to silently catch the case where the slice is broken at the build level before inviting me to try, so that the demo invitation isn't pointing me at something that doesn't even compile.

9. As a non-technical user, I want to close the app mid-slice and come back later to a short recap that lets me say *"keep going"* or redirect, so that the work is paced by my attention, not by a process running in the background.

10. As a non-technical user, I want bug reports after the demo to feel like normal conversation, not a ticketing system, so that I can describe what's wrong in my own words and get a fresh attempt without ceremony.

11. As the developer, I want the sub-agent's terminal state to be a structured `complete | failure | blocked` enum, so that the persona's per-state behavior is testable and the contract is durable.

12. As the developer, I want the dispatch tool to be a thin wrapper over pi.dev's sub-agent primitive, so that retries, isolation, and resource loading aren't reimplemented in sidecar code (per ADR 0002).

13. As the developer, I want the build-check to be a separate tool from per-task dispatch, so that *"this slice composes"* and *"this piece is built"* are observably different concerns.

14. As the developer, I want `ProjectPhase` derivable from on-disk state (brief, PRDs, issues, tasks.html, tick state), so that resume after a crash needs no separate state file.

15. As the developer, I want the Tasks tab to follow the existing `useProjectFile` polling + iframe rendering pattern (per the brief and Plan tabs), so that the new artifact does not introduce a parallel rendering path.

## Implementation Decisions

### New custom tools in the sidecar

Two new pi.dev custom tools are added beside the existing `set_creating` and `set_project_name` in the sidecar's tool registry, both following the *"declared side effect, thin tool, deep module behind it"* pattern set by ADR 0002:

- **`start_task`**. Parameters: a reference to the target issue (the issue file's slice prefix and slug, or its project-relative path — naming finalized at implementation time, but the tool does not take a free-form prompt). Behavior: launches a pi.dev sub-agent / sub-session against the active project's working tree with a fixed instruction set — read the named issue file and its source PRD, implement the issue with red-green TDD against the existing test harness, and terminate by returning a structured outcome. Return: a `{ outcome: "complete" | "failure" | "blocked", message: string }` payload, with `message` short enough for the persona to fold into its own voice without further interpretation. Guidelines on the tool itself instruct the persona to drop one short chat line per piece, tick `tasks.html` on `complete`, surface on `blocked`, and apply the N=2 retry rule on `failure`.

- **`verify_slice`**. Parameters: none beyond the active project context. Behavior: runs the project's build and/or typecheck — exactly which commands lives behind the deep module, not in the tool's surface — and reports a structured success/failure result. The persona invokes this after the last `complete`. On failure, the persona surfaces as `blocked`-class. On success, the persona invites the user to try the slice in plain language.

The two tools are deliberately separate. *"This piece is built"* and *"this slice composes as a whole"* are different claims. Collapsing them into one tool ("dispatch with a verify mode") muddies that boundary in code and in the persona's per-tool guidelines.

### Sub-agent dispatch, behind a deep module

The actual call into pi.dev's sub-agent / sub-session primitive lives in a sidecar module separate from the tool definitions. Inputs: an issue identifier, the active project's working tree, a fixed instruction template (TDD posture, return-shape contract). Outputs: the same `{ outcome, message }` shape the tool returns. This module owns:

- Loading the issue file and its source PRD as the explicit handoff context.
- Composing the sub-agent's system prompt (TDD instruction, *"return one of these three terminal states"* contract).
- Mapping pi.dev's native sub-agent return shape — whatever it is at the version pinned in `sidecar/package.json` — to the `{ complete, failure, blocked }` enum. The mapping is a pure function and is the natural deep-module test seam.

`start_task` is the thin tool surface; this module is the deep module behind it. Tests target the module directly with mocked pi.dev sub-agent results.

### Build-check, behind a deep module

`verify_slice` similarly delegates to a small sidecar module that knows how to find and run the active project's build/typecheck. For v0, the rule is simple: if `package.json` is present and defines a `build` or `typecheck` script, run it; otherwise, return success without claiming the build was checked (the persona's *"I think it's working"* framing is honest in that case anyway). The exact heuristic is intentionally narrow — multi-language project support is out of scope for this slice.

### `creating_started.target` enum extends to include `"tasks"`

The existing `set_creating` tool's `target` parameter union and the corresponding `creating_started` event payload type both gain a `"tasks"` literal. The persona uses it once at the start of Implementing — bracketing the initial `tasks.html` write — per the rule already documented in `prompts/persona.md`. Per-task dispatches do **not** double-bracket; the Tasks tab itself is the visible surface after that initial moment.

### `ProjectPhase` enum extends with implementing states

The existing `ProjectPhase` derivation in the sidecar (currently `scoping → scoped → slicing-prd-done → sliced`) gains two new states downstream of `sliced`:

- **`implementing`** — `tasks.html` is present at the project root with at least one unchecked entry.
- **`implemented`** — `tasks.html` is present with every entry checked.

Detection stays file-system-derived; no separate phase state file is introduced. *"Slice was demoed and confirmed by the user"* is intentionally **not** a phase — it lives in the conversation and the next slice's planning, not in a derivable file signal. Keeping that out of the phase enum prevents tempting future code into asking the wrong questions of on-disk state.

### Tasks tab in the frontend

The Tasks tab follows the existing brief/Plan rendering pattern exactly — no new rendering path:

- A new `"tasks"` key joins `"project"` and `"plan"` in the panel-tab union.
- `useProjectFile("tasks.html")` polls the file the same way `useProjectFile("brief.html")` and `useProjectFile("plan.html")` already do.
- The tab's `available` flag is true when `tasks.html` exists (non-empty content). Until then, the tab is hidden or disabled, matching how the Plan tab gates on `plan.html`.
- Auto-switch behavior matches the existing Plan auto-switch in `useActivePanelTab`: the first time `tasks.html` appears in a session, the active tab moves to Tasks. Subsequent ticks (file rewrites with one more checkbox) do **not** re-trigger an auto-switch.
- Rendering: same iframe / sandboxed-HTML approach as brief and Plan. The persona writes a self-contained HTML file with inline styles; the frontend just displays it.

In-flight per-task visualization (e.g., a spinner on the *"currently being worked on"* task) is **not** part of v0. The Tasks tab shows checked vs. unchecked; the chat narrates which piece is in flight. Adding an in-progress state to the rendering is a follow-up if it proves needed.

### `write-issue` skill prompt: 3–6 cap

The skill's current *"Prefer a handful of small issues over one broad issue"* language is replaced with an explicit 3–6 cap, matching the persona prompt's existing 3–6 plan-pieces range. The 1:1 alignment between Plan-pieces and Tasks-tab tasks (decided in ADR 0004) hangs off this cap; without it, the Plan tab and Tasks tab can diverge in count and the user sees a mismatch.

The cap applies to **user-project** slicing only. The meta-build's own slice planning (this PRD, future ones) goes through `/to-prd` and `/to-issue` and is not affected.

### Persona prompt is already updated

Commit `371c291 docs(implementing): persona-in-loop dispatch design …` landed the persona prompt's Implementing section in advance of this slice. No further persona-prompt edits are expected as part of this slice — it consumes what's already there.

## Testing Decisions

Testing follows the existing repo split: frontend tests under `src/test/*` via Vitest + jsdom, sidecar tests under `sidecar/tests/*` via Bun's test runner. The bar is *test the external behavior, not the implementation*: prefer running through the protocol and asserting on emitted events over poking at internal state.

### What gets tested

- **Sub-agent terminal-state mapping (deep module).** Pure-function unit tests covering the three outcome cases and an unrecognized/malformed-result path. The mapping is the most behavior-shaping pure function in this slice and the easiest to regress silently.

- **`ProjectPhase` derivation.** Extend the existing emit-tests for `project_state` to cover `implementing` (tasks.html with unticked entries) and `implemented` (all ticked) cases. The detection is straightforward but it's the load-bearing input for any future *"what phase are we in"* logic.

- **`start_task` tool wiring.** Sidecar protocol-level test: a fake pi.dev sub-agent result flows through to the expected tool return payload. This is the seam where the tool's contract meets the deep module; we want it asserted end-to-end inside the sidecar process.

- **`verify_slice` tool, with mocked project tree.** Verify the build-check heuristic against a temporary project tree with and without a `build` script in `package.json`. This is a small surface but will absorb a lot of bug-fix pressure once real projects start hitting it.

- **`creating_started.target` accepts `"tasks"`** end-to-end: persona-level pi.dev call → sidecar emits the typed event with the new literal.

- **Tasks tab availability and auto-switch.** Frontend test: when `tasks.html` first becomes non-empty, the active tab moves to Tasks; on subsequent rewrites it does not. Mirrors the existing Plan-tab auto-switch test.

- **Tasks tab rendering smoke test.** A minimal *"renders a checklist with the right number of items"* test against a representative tasks.html string. The HTML itself is the persona's responsibility, but the frontend's display path needs a smoke check.

### Prior art

- `sidecar/tests/protocol.test.ts` already exercises sidecar startup, persona-tool roundtrips, and project-state emission. New tool tests slot in alongside the existing ones.
- `src/PanelTabs.test.tsx` and `src/useActivePanelTab.test.ts` (and the rest under `src/`) cover the existing tab / auto-switch behavior. The Tasks-tab tests follow the same shape.
- Slice 03's tests for `set_creating` are the closest prior art for the new tools' protocol-level tests.

### Tests deliberately not written

- **End-to-end "real sub-agent run"** tests are out of scope. Pi.dev's sub-agent primitive is exercised in pi.dev's own test suite; recreating an end-to-end coding loop in this repo's tests is expensive and brittle. The sidecar tests stop at the deep-module seam, with mocked sub-agent results.

- **The persona's narration text.** Whether the Guide says *"now working on the first piece"* or *"on to the next one"* is prompt territory and changes with prompt edits. Tests on exact phrasing rot fast; we test that *one* short chat line lands per task, not *which* line.

- **`tasks.html` HTML structure tests beyond a smoke check.** The persona owns the HTML's shape. Pinning it down in a frontend test couples the test suite to the prompt's current visual output and breaks every time the persona's voice tightens.

- **Build-check across non-Node projects.** v0 is Node/TypeScript-shaped. Multi-language project support is a separate slice if and when it lands.

## Out of Scope

- **Bug-fix flow after the demo.** When the user reports a problem after trying the slice, the persona handles it ad hoc — propose what to try, get the nod, dispatch a fresh sub-agent run against the relevant piece. Whether to write a new issue file, whether the Tasks tab gains a new entry, and how repeated bug-fix dispatches surface in the panel are all open questions, deferred to the moment the question becomes load-bearing per ADR 0004.

- **Multi-slice flow.** This slice settles a single slice's Implementing arc end-to-end. After the user demos and confirms a slice, what triggers the next slice's slicing turn — persona auto-proposing or user asking — is left for a later slice. The persona prompt's *"do not pre-propose the next slice"* rule already keeps the v0 behavior conservative.

- **Streaming sub-agent progress mid-run.** The chat surface during a single in-flight task is one short line at start, silent during the run, one short line on outcome. Translating pi.dev's intra-run events into persona-voiced narration is real work and a real failure surface (see ADR 0004's *"surface every event"* alternative); deferred until users complain about the silent middle.

- **In-flight visualization on the Tasks tab.** A spinner / highlight on the currently-executing task. v0 ships checked vs. unchecked only; chat narration covers in-flight identification. Add later if the missing signal hurts.

- **Multi-language build-check support.** v0 reads `package.json` and runs `build` or `typecheck` if present, otherwise returns success silently. Python, Rust, Go, etc. are out of scope until they show up as real user projects.

- **ADR 0003 path-scheme reconciliation.** The slicing skills currently write to `<project>/prds/` and `<project>/issues/` (commit `66e8853`), not the `.guide/`-prefixed paths ADR 0003 documented. This slice consumes the current paths but does not amend ADR 0003. Reconciliation happens in a separate doc-only commit / amendment when someone has the energy.

- **Cancel / pause buttons in the UI.** A literal *"stop"* button on the Tasks tab. The persona's redirect-anytime contract via chat is the v0 cancel surface; UI affordances for cancel are deferred.

- **Cost / token telemetry for sub-agent runs.** Worth having eventually, out of scope for v0.

## Further Notes

- **Sequencing.** The two custom tools (`start_task`, `verify_slice`) and the `creating_started.target` extension are independent of the frontend Tasks tab; they can be implemented and tested in parallel. The `write-issue` skill cap is a one-line edit and can land in either order. The end-to-end demo (running through Implementing inside the app against a real pi.dev sub-agent) can only happen once both halves are in place.

- **pi.dev API verification.** The exact sub-agent / sub-session API on `@mariozechner/pi-coding-agent@0.70.5` should be verified during the first issue's implementation. The deep module's sub-agent invocation shape and the terminal-state mapping are best designed against the actual API surface, not against ADR 0002's general framing. If pi.dev's sub-agent shape doesn't naturally fit the `{ complete, failure, blocked }` contract, surface it as a blocker before implementing — don't paper over the mismatch.

- **`tasks.html` visual treatment.** ADR 0004 calls for *"a third accent color"* distinct from the brief's amber and the Plan's green. The persona prompt is silent on which accent. Pick at implementation time and pin it in the persona prompt as part of the Tasks-tab landing issue, so two different drafts of the file don't drift.

- **Phase auto-detection edge cases.** A `tasks.html` that exists but is empty or malformed should resolve to whatever phase the rest of the file system implies, not crash the phase derivation. Worth a defensive test.

- **Risk: long-running tool calls.** A single `start_task` call can run for several minutes. The sidecar's stdio protocol handles this fine today (other tool calls are async), but the chat surface goes silent for that interval. The Tasks tab is the user's progress surface during the wait — its design needs to be plausible for a multi-minute idle. If the tab feels dead during a long run, add the in-flight visualization called out under *Out of Scope*.

- **Risk: sub-agent classifying everything as `complete`.** If the sub-agent's prompt or the terminal-state mapping is loose enough that real failures land as `complete`, the persona will tick boxes for broken work and the user's demo will reveal it cold. The build-check (`verify_slice`) catches gross integration failures; subtler per-task wrongness is the user's demo's responsibility. Worth watching the first few real runs for signs the mapping is too lenient.
