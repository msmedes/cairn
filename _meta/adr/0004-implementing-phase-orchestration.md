# Implementing-phase orchestration

## Status

Accepted.

## Context

Slicing produces three artifacts: a PRD (engineering interpretation of the slice), a set of issue files (vertical slices through the layers, each with acceptance criteria), and `plan.json` schema-validated Artifact data for the user-visible Plan. Implementing is the phase that turns those issues into working code.

Until this ADR, the persona prompt has only one sentence on Implementing: *"sub-agents do the actual coding while the Cairn narrates."* That undersells a phase with several real forks: where the dispatch loop lives, what a sub-agent's terminal contract looks like, how progress reaches the chat surface, how failures are handled, when the slice is "done," and how the phase resumes after the app is closed mid-run. Without an explicit shape, ad-hoc decisions land each time and drift the persona's contract — most importantly its single-voice rule and its *"never claim something is working without seeing evidence"* rule.

The shape competes against an external alternative: `ralph.sh`, the meta-build's autonomous Codex-driven loop that consumes GitHub issues and ships PRs. `ralph.sh` is fine for the team's own engineering work but a wrong fit inside a user's Project — there is no GitHub, no PR ceremony, and the persona is meant to be the only entity holding state. An Implementing flow inside Cairn-the-product needs to be designed for the persona's contract first, not borrowed from the meta-build's CI harness.

## Decision

The persona itself is the orchestrator. During Implementing, the persona's tool-calling thread holds the dispatch loop; sub-agents are dispatched one issue at a time as a side-effecting custom tool, return a structured terminal state, and the persona advances through a user-visible task list rendered in a new `Tasks` tab.

### Persona-in-the-loop dispatch

The persona dispatches sub-agents directly, via `spawn_subagent` registered in `sidecar/tools/cairn-tools.ts`. The tool wraps a pi.dev sub-agent / sub-session (per ADR 0002), launched against the project's working tree, with the issue file and PRD as the explicit handoff artifacts. The dispatch is synchronous from the persona's perspective: the tool call blocks until the sub-agent returns. The persona's chat thread is therefore the long-running thing during Implementing.

Out-of-loop dispatch (a separate worker process the persona observes) was considered and rejected — see Considered alternatives.

### Sub-agent return contract

Every sub-agent run terminates in one of three structured states:

- **`complete`** — the work is done. Tests written and passing per the issue's acceptance criteria.
- **`failure`** — the sub-agent hit something it could not recover from in this run, but the work itself is still achievable. A fresh run is likely to succeed.
- **`blocked`** — the sub-agent cannot complete without intervention. Causes include user-intent ambiguity that the persona could not resolve from context, missing decisions, or genuine technical walls.

The dispatch tool returns the terminal state plus a short message. The persona keys behavior off the state, not off the message text.

### Retry and escalation

- `complete` → persona calls `update_task_status(task_slug, "done")`, drops one short chat line, and dispatches the next `todo` task.
- `failure` → persona drops one short chat line in plain language (*"running into some resistance, trying again"*), re-dispatches a fresh sub-agent run for the same task. After **two consecutive `failure`s** on the same task without a `complete`, escalate to `blocked` semantics.
- `blocked` → persona stops dispatching, surfaces the situation in plain language, offers two or three concrete options. Awaits user input.

The retry visibility (chat line, not silent) is deliberate: silent retries would hide work from the user, violating the persona's transparency principle.

### Tasks tab

Implementing introduces a new user-visible artifact: `<project>/tasks.json`, sibling of `brief.json` and `plan.json`, surfaced through a new `Tasks` panel tab. The persona creates this artifact when Implementing begins, with every task starting as `todo`, then updates task status by slug as work progresses.

The tab content is a persona-voiced checklist: one entry per issue, in plain language. The Plan tab's *"pieces I'll work through"* section and the Tasks tab show the same items in two states — the Plan describes what will be built, Tasks shows what has been built. Visual treatment matches the existing brief/plan shell (Kanagawa palette, inline styles), but Tasks is a single-view checklist rather than a multi-section slideshow.

### One-to-one alignment between issues and plan-pieces

To keep the Plan tab and Tasks tab coherent for the user, the slicing skill is constrained to produce **3–6 issues per slice**, matching the persona prompt's existing 3–6 cap on plan-pieces. The Plan's *"pieces I'll work through"* and the Tasks tab's task labels share the same plain-language descriptions, derived once and used in both places.

This is a real tightening of `write-issue`'s current *"handful of small issues"* language. The slicing skill's prompt is updated to enforce the count constraint as part of this ADR's consequences.

### Implementing trigger

The persona does not auto-transition into Implementing after `plan.json` lands. It asks for go-ahead in chat — *"Want me to start on this?"* or similar — and waits. User confirms → persona creates the initial `tasks.json` through `create_tasks_artifact` (bracketed by `set_creating(target="tasks", …)`) and dispatches the first sub-agent. User redirects → back to slicing or scoping as needed.

Auto-transition was considered and rejected: the Plan exists to be read, and starting dispatch the same turn the Plan is written runs over the user's chance to engage with what they just agreed to.

### Slice "done" — build-check + demo invite

When all tasks are `done`, the persona does **not** immediately declare the slice done or auto-advance to the next slice. It runs the project's build / typecheck (silent, automatable) to catch the integration-level failure mode that per-issue TDD cannot — issues that pass in isolation but fail to compose. Two outcomes:

- Build passes → persona invites the user to try the slice in plain language: *"the pieces are in place — give it a try and let me know how it feels."* Slice ends when the user confirms it works or reports a problem.
- Build fails → persona surfaces as `blocked`-class: plain-language description of what went wrong, two or three options.

The user's demo is the source of truth for *"working in the user's hands."* The build-check provides an automated floor below that. Together they preserve the persona prompt's *"Never claim something is working without seeing evidence"* posture.

### Resume after app close

If the app is closed mid-Implementing, the sidecar exits and any in-flight sub-agent run dies with it. On hydrate, the persona session resumes against persisted state: `tasks.json` reflects whichever task status updates landed before close. The persona produces a recap turn — *"we were working through these pieces — want me to keep going on the next one?"* — using the existing recap pattern, and waits for direction.

In-flight sub-agent state is not tracked durably. Worst case on resume: a sub-agent run completed but its final task status update was not persisted before close, so the persona re-dispatches the same task; the second run trivially passes (idempotent under TDD). One wasted run is the price for not building durable in-flight state, which we accept for v0.

### Indicator usage

The `set_creating` indicator (per ADR 0001) is used **once during Implementing**: bracketing the initial `tasks.json` creation at the start of the phase. After that, the Tasks tab itself is the visible progress surface. Per-task dispatches do not double-bracket — they update an existing artifact, not create a new one.

The `target` enum gains a new entry `"tasks"`. The `creating_started` event payload format is unchanged.

## Considered alternatives

- **Out-of-loop dispatch (separate worker process the persona observes).** The persona reads progress from a file or IPC channel; dispatch happens elsewhere. Rejected: the persona's contract puts it in the position of answering sub-agent questions with stakes (per `prompts/persona.md`'s *"answer it yourself"* rule). That is only synchronous and cheap when the persona is the addressee, i.e., the dispatcher. It is also the natural redirect surface — *"wait, I don't like where this is going"* turns into cross-process coordination in this shape.

- **Silent retry on `failure`.** Persona retries quietly without narrating; the user sees a panel that just sits longer. Rejected: silent retry is opaque, and the user reads silence-during-work as something being hidden. The transparency principle wins over the smoother surface.

- **Surface every `failure` as if it were `blocked`.** Treats the `failure`/`blocked` distinction as cosmetic. Rejected: collapses the structured contract into a single user-interrupting state, and over-escalates transient errors that the sub-agent itself classified as recoverable.

- **Auto-transition into Implementing after `plan.json` lands.** Persona writes the Plan, then immediately dispatches the first sub-agent. Rejected: the Plan tab is meant to be read; starting execution on top of it the same turn wastes the artifact's purpose.

- **Skip the build-check; trust per-task TDD.** Each issue's tests pass → declare slice done, invite demo. Rejected: per-task TDD is local; nothing else verifies the assembled slice. Inviting the demo on a slice that does not even compile destroys the *"I think it's working"* framing fast.

- **Persona-side independent verification beyond the build-check** (running the test suite again, lint, smoke harness). Rejected for v0: redundant with the sub-agent's own TDD in most cases, and the user's demo is the load-bearing verification regardless.

- **Track in-flight sub-agent state durably.** Persist *"currently running task X"* to disk so resume can re-attach. Rejected: a lot of mechanism to save one wasted run worst-case. Worth revisiting only if sub-agent runs become expensive enough that wasted re-runs hurt.

- **Auto-advance to next slice after demo confirmation.** Persona-driven multi-slice progression without an explicit *"what's next"* turn from the user. Out of scope for this ADR — multi-slice flow is deferred until a single-slice Implementing path is proven.

## Consequences

- **Custom sub-agent dispatch in `sidecar/tools/cairn-tools.ts`** via `spawn_subagent`. Side-effecting; registers with the pi.dev `AgentSession`. Returns a structured `{ outcome: "complete" | "failure" | "blocked", message: string }` payload for implementation work. Wraps a pi.dev sub-agent / sub-session, launched in the project working tree with the issue file and PRD as the explicit handoff artifacts and a red-green TDD instruction.

- **Task artifact tools in `sidecar/tools/cairn-tools.ts`** create `tasks.json` through `create_tasks_artifact` and update progress through `update_task_status(task_slug, status)`.

- **`creating_started` `target` enum extends to include `"tasks"`** for the initial Tasks artifact creation.

- **`ProjectPhase` enum (`sidecar/index.ts`) extends** to include an `"implementing"` state and an `"implemented"` state for slice-done. Naming finalized at implementation time.

- **`write-issue` skill prompt** gains a hard cap: 3–6 issues per slice, matching plan-pieces. The current *"handful of small issues"* language is replaced with the explicit range. Re-slicing logic (overwrite same `NN`) unchanged.

- **Persona prompt grows a real Implementing section** comparable in size to the Slicing section. Covers: the propose-go-ahead turn, the initial Tasks artifact creation with `set_creating` bracket, the dispatch loop and per-task chat narration, the `failure` retry rule (visible, N=2), the `blocked` surfacing pattern, the build-check + demo invite, and the resume recap.

- **Bug-fix flow after demo is deferred.** When the user demos and reports a problem, the persona handles it ad hoc — propose what to try, get the user's nod, dispatch a fresh sub-agent run against the relevant piece. The exact handoff shape, whether to write a new issue file, and how the Tasks tab reflects post-demo work are open questions to resolve under usage. This ADR explicitly declines to settle them.

- **Path layout note.** This ADR uses `<project>/prds/`, `<project>/issues/`, and schema-validated Artifact data at the Project root. ADR 0005 supersedes the earlier generated-artifact path assumptions for Brief, Plan, and Tasks.

- **Multi-slice flow stays out of scope.** This ADR settles a single slice's Implementing arc end-to-end. Whether the persona auto-proposes the next slice after a confirmed demo, or waits for the user to ask, is left for the moment that question becomes load-bearing.
