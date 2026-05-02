# PRD — Slice 04: Slicing skills (write-prd, write-issue)

## Superseded by Slice 08

This PRD records the historical slice design. Slice 08 and ADR 0005 supersede its generated-HTML artifact assumptions: Brief, Plan, and Tasks are now schema-validated JSON Artifact data, rendered by the app, and task progress is slug-based rather than index-based HTML mutation.

## Problem Statement

The wife finishes scoping. The Cairn writes her brief. She names the project. The brief feels like the start of something. Then the conversation goes nowhere, because v0 stops at brief — every subsequent turn is the persona finding things to talk about while the project sits frozen at "brief written; slicing not implemented." The whole point of Cairn is to take her from idea to running app, and right now the path stops at the first signpost.

For the owner — running this loop on his own ideas, watching the wife and the friend run it on theirs — the missing layer is the one that converts a finished brief into something the harness can actually build. The dev workflow already has the shape: `/to-prd` against the conversation produces a PRD; `/to-issue` against the PRD produces issues; Ralph (or sub-agents) pick up issues and implement them. The Cairn app has none of that. Slicing exists in `CONTEXT.md` as a phase name and in `prompts/persona.md` as a single sentence — *"You write the PRD and issues for that slice silently, in the background"* — and nowhere as code.

## Solution

When the brief is concrete enough that the persona can name a first chunk worth building, it proposes that chunk in plain language. The user agrees in a beat or two — *"yes, start there"* — or redirects. Once they agree, the persona quietly puts together a plan: a PRD describing the slice, then a small handful of issues describing the work. The user does not see the PRD or the issues unless they ask; what they see is a short message in the panel — *"Putting your plan together…"* — and a one-line confirmation in chat when it lands.

If the brief is genuinely too thin to write a useful PRD (*"the user said they want a quiz app but never said what kind of quizzes"*), the silent work pauses. The persona surfaces one targeted question in their voice, takes the user's reply, and resumes. No second grilling round; no thirty-question interrogation. One real ambiguity at a time, when the work hits it.

This is the layer that makes Implementing possible. Once issues exist on disk in the user's project folder, the next slice (Implementing) has a backlog to pull from. The path from idea to running app stops being theoretical.

## User Stories

1. As a non-technical user, when my brief feels concrete, I want the Cairn to propose a first chunk to build in plain language, so I can agree or redirect without having to know what a "slice" is.
2. As a non-technical user, when I agree on the first chunk, I want the panel to show a short message in the Cairn's voice while the plan is being put together, so the gap between "yes, start there" and "the plan exists" doesn't feel dead.
3. As a non-technical user, I want the Cairn to confirm in one short line in chat when the plan is ready, without reciting what was made, so I know it's done without feeling lectured at.
4. As a non-technical user, when the Cairn hits a real ambiguity while planning, I want it to ask one targeted question in its normal voice, so I'm filling a real gap rather than answering a list of pre-emptive questions.
5. As a non-technical user, when I redirect after the plan is written (*"actually, can we start with scoring?"*), I want the Cairn to scrap the old plan and put together a new one, so I never feel like I've committed to a path I can't change.
6. As a non-technical user, I never want to see the PRD or issue files unless I explicitly ask, so engineering scaffolding stays out of my way.
7. As a non-technical user, if I do ask to see the plan, I want the Cairn to describe it in plain language — not show me a markdown file — so I'm not staring at engineer text I didn't sign up for.
8. As the project owner, I want the persona to decide when scoping has run its course based on first-slice-nameable judgment, not a list of fields a brief must contain, so the bar is calibrated by conversation quality rather than checklist completeness.
9. As the project owner, I want the slicing capabilities (`write-prd`, `write-issue`) implemented as pi.dev skills under `prompts/skills/`, not as bespoke sidecar tools, so the project honors the "default to pi.dev primitives" principle (ADR 0002).
10. As the project owner, I want `write-prd` and `write-issue` to be two separate skills the persona invokes in sequence, so each stage can pause to ask a clarifying question without contaminating the other and re-slicing only re-runs what changed.
11. As the project owner, I want PRD and issue files written under `<project>/.cairn/prds/<NN>-<slug>.md` and `<project>/.cairn/issues/<NN>-<slug>.md`, so engineering scaffolding lives in a hidden dot-folder and stays separated from the actual app code that lands in the project root during Implementing.
12. As the project owner, I want re-slicing to overwrite the existing slot 01 files, not increment to slot 02, so there is exactly one canonical slice on disk and Implementing has no ambiguity about which is live.
13. As the project owner, I want the `set_creating` target enum extended to include `"prd"` and `"issues"` (per ADR 0001), with the panel showing one short Cairn-voice message per phase, so the bracketing rule the persona already follows for the brief generalizes without parallel mechanisms.
14. As the project owner, I want the skill descriptions tight enough that the persona auto-discovers them via pi.dev's progressive disclosure, so the persona's base-context system prompt does not bloat with the full SKILL.md bodies.
15. As the project owner, I want each skill's SKILL.md to instruct the writing agent to return a single targeted clarifying question when the input genuinely doesn't support a useful artifact, so quality is enforced at the stage that knows what quality looks like.
16. As the project owner, I want the existing comment at `sidecar/cairn-tools.ts:18-21` (which names `write_prd` / `write_issue` as future *tools*) corrected when this slice lands, so the next reader is not misled about the intended mechanism.
17. As the project owner, I want phase to remain derived from artifacts (brief exists? slice proposed? PRD written?) rather than persisted on Project state, so v1 does not over-build a state machine that Implementing has not yet forced.

## Implementation Decisions

### Modules

- **`prompts/skills/write-prd/SKILL.md`** *(new)*. Frontmatter: `name: write-prd`, `description: <persona-trigger language>`, `disable-model-invocation: false`. Body ports the relevant `/to-prd` skill semantics. Instructs the writing agent to read `<project>/brief.html` plus the current session context, and write a PRD to `<project>/.cairn/prds/<NN>-<slug>.md` where `NN` is the zero-padded next sequence and `<slug>` is kebab-cased from the slice title. Final instruction: if a load-bearing dimension of the slice is genuinely missing from the brief, output a single targeted question in the persona's voice instead of writing the file, so the persona can ask the user once and re-invoke.

- **`prompts/skills/write-issue/SKILL.md`** *(new)*. Same frontmatter shape. Body ports `/to-issue` semantics, adjusted for local files. Reads the most recently written PRD path under `<project>/.cairn/prds/`, produces vertical-slice issues as markdown files under `<project>/.cairn/issues/`. Issue body matches `/to-issue`'s template, with: `## Source` referencing the project-relative PRD path; `## Blocked by` using other issue file slugs (no GitHub issue numbers); `## Parent` section omitted (no upstream issue).

- **Sidecar wiring** *(modification to `sidecar/index.ts`)*. The `DefaultResourceLoader` construction at `sidecar/index.ts:266-272` gains `additionalSkillPaths: [resolve(repoRoot, "prompts/skills")]`. The repo root is resolvable from `import.meta.url` at sidecar startup; the constant is set once at module load. No other sidecar protocol changes required for skill discovery — pi.dev's `loadSkills` recurses into the directory and finds both SKILL.md files automatically.

- **`set_creating` tool extension** *(modification to `sidecar/cairn-tools.ts`)*. The `target` parameter union extends from `Type.Union([Type.Literal("brief")])` to `Type.Union([Type.Literal("brief"), Type.Literal("prd"), Type.Literal("issues")])`. The `OutMsg.creating_started` type in `sidecar/index.ts` widens to match. The `CreatingTarget` type alias updates to the same set. `promptGuidelines` get one additional bullet acknowledging the new targets without leaking implementation paths.

- **`useCreatingIndicator` hook** *(modification to `src/useCreatingIndicator.ts`)*. The target-content map gains entries for `"prd"` (watches `<project>/.cairn/prds/`) and `"issues"` (watches `<project>/.cairn/issues/`). Auto-clear fires when the watched directory transitions from "no matching file" to "at least one file matching the target's slot prefix." `agent_end` continues to fire as the abandoned-mid-creation fallback. Hook output type unchanged.

- **App shell** *(modification to `src/App.tsx`)*. The placeholder branch already handles `creating` non-null. No new structural changes; `creating.target` flows through the same headline + ghost-line treatment for `"prd"` and `"issues"` as it does for `"brief"`.

- **Persona prompt** *(modification to `prompts/persona.md`)*. The Slicing bullet under "Your job" is rewritten to commit the persona to: (a) propose one slice in plain language when the brief is concrete enough that a first chunk is nameable; (b) await user agreement; (c) on agreement, invoke `write-prd` (loaded by progressive disclosure), then `write-issue` once the PRD lands; (d) bracket each skill invocation with `set_creating(target="prd"|"issues", ...)` and one short chat line per the existing bracketing rule; (e) confirm in one short chat line when both artifacts have landed. The "Where you are right now" section is updated to drop the absolute "stay in scoping" instruction once the brief exists and the project has been named — the bar becomes "first-slice-nameable," not "the user has explicitly asked to move on."

- **`sidecar/cairn-tools.ts:18-21` comment update.** The comment that names `write_prd` / `write_issue` as future *tools* is corrected to reflect that they ship as skills under `prompts/skills/`, with the established sidecar tool pattern reserved for declared side effects (e.g., `set_project_name`, `set_creating`). One-line change; not behavioral.

### Architectural decisions

- **Skills, not tools.** Per ADR 0002. Writing a PRD is instruction-following work in the agent's own context; pi.dev's skills feature exists for exactly that case. Implementing as a tool would mean either inlining the PRD body into a tool param (awkward; inflates the persona's `text_delta` stream and pollutes the schema) or running a second Anthropic call from inside the tool's `execute` (negates the pi.dev-native path). Skills give us progressive disclosure, named auto-discovery, and base-context size control as primitives instead of bespoke sidecar features.

- **Persona orchestrates two skills, sequentially.** Independent skills mean each stage can pause to ask a clarifying question without contaminating the other. Re-slicing only re-runs the affected stage. Mirrors the dev-workflow precedent (`/to-prd` then `/to-issue`) where the same separation is load-bearing.

- **Quality enforced per stage with bubble-up.** Each skill instructs the writing agent to return a single targeted clarifying question when a load-bearing dimension is missing. The persona pauses, asks the user in their voice, and re-invokes the skill on reply. This is the same pattern `prompts/persona.md` already specifies for sub-agents in Implementing — extending it here means one mental model in the system, not two.

- **Persona judgment, not artifact detection, decides when Slicing starts.** The bar is "first-slice-nameable" — the persona can name a first chunk worth building from the brief. Not "enough info to implement" (impossible to know up front; sub-agents will surface gaps as they hit them; would force a thirty-question interrogation that violates the "five questions, not thirty" rule). Not "brief.html exists + project named" (artifact-derived, but too coarse — the brief might exist and still be too thin). Lives in persona prompt wording, not in code.

- **Re-slicing overwrites slot 01.** No versioning. Matches v0 ethos (*"if they want to redo, they restart"* — `_meta/project-brief.md`) and the brief's regeneration model. Versioning is a v2+ concern, addressable later via git on the project folder if it becomes one. Skill SKILL.md instructs the writing agent to overwrite the existing slot when the slug differs from the previous slice for the same `NN`.

- **Phase remains derived from artifacts.** No persisted "phase" field on Project state. The persona's view of phase is implicit — *brief exists? slice proposed? PRD written? issues written?* — and that is enough for v1. When Implementing lands and needs to know "is this slice still live or done," that pressure justifies persisting phase. Not before.

- **No GitHub issue mirroring.** Issues stay as local markdown files under `.cairn/issues/`. No `gh issue create`. `_meta/project-brief.md` commits to *"local files in a folder (no GitHub, no cloud)"* in v0; this slice honors it.

### Skills location and discovery

- **In-repo path**: `prompts/skills/write-prd/SKILL.md`, `prompts/skills/write-issue/SKILL.md`. Sits next to `persona.md` and `ralph-loop.md`, the existing convention for prompt resources that ship with the Cairn app.
- **Wiring**: `additionalSkillPaths: [<repoRoot>/prompts/skills]` passed to `DefaultResourceLoader` at `sidecar/index.ts:266`. pi.dev's `loadSkills` recurses into the directory tree and finds both SKILL.md files via the standard discovery rules.
- **Frontmatter**: `disable-model-invocation: false` (default). Skill names + descriptions auto-inject into the persona's system prompt at session creation; full SKILL.md body loads on-demand when the persona decides to invoke. Progressive disclosure means base-context size does not grow with the SKILL.md bodies themselves — only with the (short) descriptions.
- **No conflict with user-project-local skills.** pi.dev's default discovery for `<cwd>/.pi/skills/` continues to function, and a future v2+ feature (per-project user-defined skills) can land in that surface without further wiring changes.

### Sidecar protocol changes

The `creating_started` event payload's `target` widens from `"brief"` to `"brief" | "prd" | "issues"`. The exhaustiveness check on the frontend listener catches missing handling at compile time (same pattern as slice 03). No new event variants; no new tool surface (`write-prd` and `write-issue` are skills, invisible to the frontend protocol). No changes to `init` / `prompt` request handling.

### Defaults / paths

- PRD path: `<project>/.cairn/prds/<NN>-<slug>.md`. `NN` is zero-padded next sequence; first slice is `01`. `<slug>` is kebab-cased from the slice title (≤ 5 words).
- Issue path: `<project>/.cairn/issues/<NN>-<slug>.md`. Multiple issues per slice share the `NN` prefix and use slug suffixes — e.g., `01-video-runtime.md`, `01-video-controls.md`. Skill SKILL.md text codifies the convention; we revisit if a flatter or differently-prefixed scheme is preferable during dogfooding.
- `set_creating` target values: `"brief"` (existing), `"prd"` (new), `"issues"` (new). Each target has a corresponding watch-target in the frontend hook.

## Testing Decisions

A good test for this slice exercises behavior the user can name — *"the persona proposes a first chunk and waits for me to agree before writing anything," "the panel narrates the planning phase," "the plan files appear under .cairn/ and stay invisible in chat unless I ask"* — not pi.dev internals.

- **Sidecar wiring smoke (`bun test`).** Extension of `sidecar/tests/protocol.test.ts`. Spawn sidecar against a fixture project; assert that pi.dev's `getSkills()` (exposed via `DefaultResourceLoader`) returns the two Cairn-bundled skills with non-empty descriptions and `disableModelInvocation === false`. Skipped without API key, same gate as the existing smoke.

- **`set_creating` enum extension, unit (`bun test`).** Extension of `sidecar/tests/cairn-tools.test.ts`. Confirm the tool accepts `target: "prd"` and `target: "issues"` and rejects an unknown value (covered by TypeBox before `execute` runs; no defensive code in the tool body). Confirm the `creating_started` callback receives the new targets verbatim.

- **`useCreatingIndicator` hook extension, unit (Vitest).** Extension of `src/useCreatingIndicator.test.ts`. Tabular coverage: `creating_started("prd", ...)` clears when a file appears under `.cairn/prds/`; `creating_started("issues", ...)` clears when a file appears under `.cairn/issues/`; abandoned-mid-creation clears on `agent_end`; overlap-replacement still works across mixed targets (e.g., `creating_started("prd", ...)` followed by `creating_started("issues", ...)`).

- **End-to-end smoke, manual.** Open the app on a clean `~/.cairn/`. Scope a project to brief + named. Agree to a proposed first slice. Verify: (1) panel headline updates to the persona's "putting plan together" message; (2) `<project>/.cairn/prds/01-*.md` appears with sensible content; (3) one or more `<project>/.cairn/issues/01-*.md` files appear; (4) panel headline clears after issues land; (5) chat receives the persona's confirmation line; (6) the SKILL.md content does *not* appear in chat or the panel; (7) `creating_started` fires twice (once per phase), each cleared by its own watch target. Negative case: kill sidecar mid-write; reopen; verify panel is the empty-placeholder state and `.cairn/` reflects whatever's actually on disk.

We deliberately do not write:

- **SKILL.md content unit tests.** Voice and quality of the resulting PRDs and issues are calibrated by reading transcripts and outputs during dogfooding, not asserted in tests. Same reasoning as persona prompt voice in slices 01–03.
- **Bubble-up clarifying-question integration tests.** The clarifying-question path is a prompt-discipline concern. If the skill bubbles up something unhelpful, the fix is the SKILL.md text, not a test stub.
- **Multi-project skill discovery tests.** `additionalSkillPaths` is a one-line config change against pi.dev's already-tested loader; re-testing pi.dev's discovery rules adds nothing.
- **PRD/issue content schema validation.** The SKILL.md instructs the writing agent on the template; the writing agent is the model, not deterministic code. Test the artifacts by reading them, not by parsing.

Prior art: `sidecar/tests/cairn-tools.test.ts` for the tool extension; `sidecar/tests/protocol.test.ts` for the sidecar smoke pattern; `src/useCreatingIndicator.test.ts` for the hook extension.

## Out of Scope

- **Implementing phase.** This slice produces issues on disk; it does not pick them up and build them. Implementing is its own slice (slice 05+) with its own design tree (sub-agent dispatch, narration, error handling, sub-agent → persona question pattern, fail/retry behavior).
- **Persisted phase state on Project.** Phase remains derived from artifacts in v1. Persisting it lands when Implementing forces the question, not before.
- **Versioning of slices.** Re-slicing overwrites slot 01; no `01a` / `01b` branching, no auto-commit of slice boundaries to a project-folder git repo. v2+ concern.
- **User-project-local skills.** pi.dev's `<cwd>/.pi/skills/` discovery continues to function and would pick up a user-defined skill if one were placed there, but Cairn does not expose this surface in v1. There is no way for the user to define a custom skill from inside the app.
- **The handoff to the next slice.** When Implementing slice 01 is done and the user is ready for slice 02, what does the persona do? Out of scope here; part of Implementing's design and the eventual loop-around behavior.
- **Multi-issue dependency graphs.** Issues for slice 01 may have a `Blocked by` chain among themselves, but the chain is linear by default in v1. Topological dispatch and parallel issue work are Implementing concerns.
- **Skill-misfire instrumentation.** No tooling to detect when the persona is mis-triggering a skill (auto-invoking when it shouldn't, or failing to auto-invoke when it should). Read transcripts during dogfooding; tighten the description if signals appear. Defer instrumentation until there is a real signal.
- **GitHub issue mirroring.** Issues stay as local markdown files. No `gh issue create`. Honors `_meta/project-brief.md`'s "no GitHub" commitment.
- **Banner overlay during slice update on existing project.** The existing creating-indicator augment-in-place treatment only covers the placeholder state. When a project already has a brief and the persona writes the PRD/issues, the panel shows the brief slideshow with no indicator overlay. Acceptable for v1; revisit when post-v0 update flows are real.

## Further Notes

- **Order of build matters.** Land `additionalSkillPaths` wiring + skill scaffolding (empty SKILL.md bodies, just frontmatter) first — small, verifiable in isolation: confirm pi.dev loads them and lists them in the system prompt. Then `write-prd`'s body, exercised via a manual run against a fixture brief. Then `write-issue`'s body. Then the `set_creating` enum extension and `useCreatingIndicator` hook updates (gated by their unit tests). Then the persona prompt update that activates Slicing in conversation. Persona prompt last — it is the only piece that activates the feature in user-visible behavior. Each step is independently demoable.

- **The SKILL.md text is the highest-stakes part of the slice.** A vague description means the persona auto-invokes at the wrong moment or fails to auto-invoke when it should; an over-tight body produces parroted, low-signal PRDs. The body's instructions are what shape PRD and issue quality across "any random session." Read the resulting PRDs and issues during dogfooding; tighten the SKILL.md if outputs drift.

- **The `disable-model-invocation: false` choice is load-bearing.** If accidentally set true, the persona stops auto-invoking and Slicing never triggers — because the user does not type slash commands.

- **Quality bar is per-stage, not at the Scoping gate.** Tempting to require the persona to ask for "all the context" before pivoting to Slicing; rejected during design because it conflicts with persona.md's *"five questions, not thirty"* rule. Each skill's SKILL.md is where its own quality bar lives, and the bubble-up clarifying-question pattern catches genuine gaps lazily.

- **`sidecar/cairn-tools.ts:18-21` is wrong post-this-slice.** The comment reads *"Future Cairn tools such as `write_prd` or `write_issue` should follow this same sidecar-local pattern"* — they aren't tools and shouldn't follow that pattern. Fix as part of the slice; do not leave dangling.

- **ADR 0002 captures the general principle** ("default to pi.dev primitives") that motivated implementing slicing as skills rather than tools. This PRD is one specific application of that principle; future slices apply the same lens before writing custom sidecar code.

- **Risk: pi.dev's progressive-disclosure model means the persona's base context lists `write-prd` and `write-issue` even during pure Scoping.** A misjudgment in the description could trigger early invocation. Mitigation: descriptions explicitly say *"use after the brief is concrete and a first slice has been agreed on."* Read transcripts during dogfooding; if the persona invokes too early, tighten the description.

- **Risk: skill auto-invocation racing with the user's redirect turn.** If the persona starts `write-prd` and the user's next message redirects, pi.dev's skill execution is mid-flight. The persona's responsibility per `prompts/persona.md` is to surface the redirect, abandon the in-flight skill output, and re-propose. Worst case: a stale `01-*.md` is written and immediately overwritten on the re-invocation. Acceptable for v1.

- **Risk: target file's content polled-watch firing on transient writes.** The skill writes the PRD via the Write tool, which is atomic from pi.dev's perspective; the frontend's `useProjectFile`-based watch should not see partial states. Confirm during integration testing; if partial reads surface, add a debounce in the hook (not in pi.dev).
