# PRD — Slice 07: Composable `spawn_subagent` dispatch

## Superseded by Slice 08

This PRD records the historical slice design. Slice 08 and ADR 0005 supersede its generated-HTML artifact assumptions: Brief, Plan, and Tasks are now schema-validated JSON Artifact data, rendered by the app, and task progress is slug-based rather than index-based HTML mutation.

## Problem Statement

The persona's main context absorbs the full bytes of every user-visible artifact it produces. Today, when the persona generates `brief.html` (~5 KB), `plan.html` (~4 KB), `tasks.html` (~2 KB), or any PRD or issue markdown, those bytes flow through Opus 4.7's context as the assistant message that contains the `Write` tool call. Per real session inspection (`~/.cairn/projects/2026-04-30-new-baby-log`), a single project's planning phase emits ~20 KB of artifact bytes through the persona's context across the brief / PRD / issues / plan steps, before any Implementing work begins. At Opus pricing this is real money over time, and it scales with project complexity rather than with conversational complexity.

It also creates a coupling that hurts as the system grows. The persona is forced to be the entity producing the artifact bytes, which means every persona-prompt edit risks affecting artifact quality, and every artifact-generation prompt change happens inside the persona's monolithic system prompt. The two responsibilities — *talking to the user* and *producing engineering artifacts* — are tangled.

The two existing sub-agent dispatchers (`start_task`, `verify_slice`) prove the isolation pattern works for code. The same pattern should cover artifact generation, with one caveat: the existing `write-prd` and `write-issue` skills are pi.dev primitives ADR 0002 explicitly endorses, so the new design must keep skills as first-class rather than collapsing them into custom dispatchers.

## Solution

A single generic `spawn_subagent` custom tool. The persona invokes it with a skill name, structured args, and a structured response schema. The tool runs a fresh pi.dev sub-session in isolation, configures it with the named skill, feeds it the args, awaits termination, validates the structured response, and returns only that response to the persona. The persona's context never sees the artifact bytes — only the dispatch parameters and the structured result.

`start_task` and `verify_slice` (which already use sub-agents) collapse into this one tool: they are `spawn_subagent` with different skill names. The artifact-generation work the persona does today via `Write` and via `read`-the-skill-then-call-`write` patterns also moves behind `spawn_subagent`, with new skills (`write-brief`, `write-plan`, `write-tasks`) joining the existing `write-prd` / `write-issue`.

Skills stay as the instruction primitive — they are the WHAT. `spawn_subagent` is the isolation primitive — it is the WHERE. The two combine cleanly.

## User Stories

This slice's user is the developer; the end user's experience is unchanged. Stories phrased from the dev / owner perspective.

1. As the dev, I want a single composable `spawn_subagent` tool, so the persona's tool surface stays small and every isolated dispatch follows one shape.
2. As the dev, I want skill names to drive sub-agent behavior, so existing skills (`write-prd`, `write-issue`) stay as the primitive without per-skill custom tools.
3. As the dev, I want the persona's context to never see artifact bytes, so Opus token cost stays roughly flat as projects produce more artifacts.
4. As the dev, I want sub-agents to default to Sonnet 4.6, so each isolated dispatch is ~5× cheaper per token than running on Opus.
5. As the dev, I want the response shape declared at the call site, so the persona declares its expectations and the validation layer can map shape mismatches to a structured failure outcome.
6. As the dev, I want `start_task` and `verify_slice` re-implemented in terms of `spawn_subagent`, so we don't maintain three parallel dispatch paths.
7. As the dev, I want sub-agents to be able to spawn their own sub-agents up to a recursion depth of 2, so future parallel-work or self-checking patterns are possible without unbounded recursion.
8. As the dev, I want the dangling-tool-call recovery extended to `spawn_subagent`, so any interrupt produces a clean failure-class outcome the persona's existing retry rule handles.
9. As the dev, I want skill-name typos and missing skills to surface as `blocked` outcomes (not crashes), so the persona's existing `blocked`-class flow handles them in plain language.
10. As a non-technical user, I want the chat surface during artifact generation to look exactly like it does today — the persona's voice, the panel's `set_creating` indicator, no engineering vocabulary — so the user-visible experience is unchanged by this refactor.
11. As the dev, I want a `tick_task` custom tool the persona uses to flip a Tasks-tab checkbox, so the rule "the persona never raw-writes or raw-edits artifact files" applies uniformly.
12. As the dev, I want the existing skill files (`write-prd/SKILL.md`, `write-issue/SKILL.md`) to keep working unchanged, so this slice does not require touching the slice-04 skills.

## Implementation Decisions

### `spawn_subagent` custom tool

A new pi.dev custom tool registered in `sidecar/cairn-tools.ts`. The thin tool surface is intentional; the deep module behind it carries the work.

Parameters:

- `skill_name`: a literal-union of known skill names (`"write-brief" | "write-plan" | "write-tasks" | "write-prd" | "write-issue" | "implement-issue" | "verify-slice"`). Using a literal union rather than free-form string lets TypeBox catch typos at tool-call validation time and surface them to the persona as a tool-call rejection rather than a `blocked` outcome.
- `args`: a structured object whose shape depends on the skill. Each skill's expected `args` shape is documented in its own SKILL.md.
- `response_schema`: an enum literal naming the response shape (`"task_outcome" | "verify_result" | "artifact_write"`). Same reasoning as `skill_name` — bounded, validatable. Three shapes cover all v0 cases:
  - `task_outcome`: `{ outcome: "complete" | "failure" | "blocked", message: string }` (matches existing `start_task`)
  - `verify_result`: `{ ok: boolean, message: string }` (matches existing `verify_slice`)
  - `artifact_write`: `{ outcome: "complete" | "failure" | "blocked", message: string, path: string }` (artifact generators that produce a file)

Returns: the structured response payload from the sub-agent's terminal output, validated against the named schema. On any failure path (skill not found, malformed response, sub-agent error, depth-limit exceeded), returns a normalized `{ outcome: "failure" | "blocked", message }` so the persona's existing retry / blocked-class rules apply uniformly.

### Deep module: `spawn-subagent.ts`

Modeled directly on the existing `start-task.ts` module. Responsibilities:

- Resolve `skill_name` against the loaded skills from the active resource loader. If not found → return `{ outcome: "blocked", message: "skill <name> not found" }`.
- Compose the sub-agent's system prompt: skill content + a structured-response instruction that names the expected response shape and instructs *"return only one JSON object matching this exact shape"*.
- Serialize `args` as the user prompt (`session.prompt(JSON.stringify(args))`).
- Run the sub-agent with `SessionManager.inMemory()` (matching `start_task`'s ephemerality).
- Map pi.dev's terminal state (`stopReason`, `errorMessage`, final assistant text) to the requested `response_schema`. Reuse the existing `mapSubAgentResult` shape where possible; widen it to handle the additional schemas.
- Validate the parsed JSON against the named schema. Schema mismatch → normalize to `{ outcome: "failure", message: "sub-agent returned a malformed result" }`.

The deep module is the test seam — pure-function `mapSubAgentResult` per schema, plus an integration-shaped test with a fake sub-agent result via env override (matching the existing `GUIDE_FAKE_*_RESULT` pattern in `start-task.ts`).

### Existing tools retired

- `start_task` (the custom tool surface in `cairn-tools.ts`) is removed. The persona prompt is updated to use `spawn_subagent({ skill_name: "implement-issue", args: { issuePath }, response_schema: "task_outcome" })`.
- `verify_slice` (the custom tool surface) is removed. Replaced by `spawn_subagent({ skill_name: "verify-slice", args: {}, response_schema: "verify_result" })`.

The deep modules `start-task.ts` and `verify-slice.ts` survive in spirit — their pi.dev sub-agent invocation patterns are absorbed into `spawn-subagent.ts`. The files themselves may be deleted if the new module fully subsumes them; that decision belongs to the implementing developer.

### New skills under `prompts/skills/`

Three new artifact-generation skills:

- `write-brief/SKILL.md` — given a structured summary of the conversation (what the user wants to build, who it is for, what done feels like), generate `brief.html` at the active project root in the persona's voice. Same Kanagawa palette, inline-styles slideshow shell as today. Skill output: `artifact_write` schema.
- `write-plan/SKILL.md` — given the slice agreement and references to the brief and the issues directory, generate `plan.html`. Same shell, green accent. Skill output: `artifact_write` schema.
- `write-tasks/SKILL.md` — given a list of issue file paths, generate `tasks.html` with one unchecked entry per issue, in plain language matching the Plan's "pieces I'll work through" section. Skill output: `artifact_write` schema.

Two skills wrapping existing tool deep modules (their content lifts the relevant prompt material from `start-task.ts` and `verify-slice.ts`):

- `implement-issue/SKILL.md` — implement a named issue with red-green TDD. Skill output: `task_outcome` schema. Replaces `start_task`'s tool-internal prompt.
- `verify-slice/SKILL.md` — run the project's build / typecheck heuristic. Skill output: `verify_result` schema.

The existing skills `write-prd/SKILL.md` and `write-issue/SKILL.md` keep their content unchanged. They get updated metadata (input shape, response shape) to be `spawn_subagent`-callable.

### Persona prompt changes

The persona's Implementing section, plus the brief / plan / tasks sections of "When you make something the user can see", get rewritten:

- Replace `Write` tool calls for `brief.html` / `plan.html` / `tasks.html` with `spawn_subagent` invocations against the corresponding `write-*` skills.
- Replace explicit `start_task` and `verify_slice` references with `spawn_subagent` invocations naming the corresponding skills.
- Add an explicit *"never use raw `Write` or `Edit` on `<project>/{brief,plan,tasks}.html`, `<project>/prds/`, `<project>/issues/`"* rule.
- Keep `set_creating` bracketing exactly as it is today; the persona still calls `set_creating(target=…)` immediately before each `spawn_subagent` for visible artifacts.
- Keep `set_project_name` as a direct tool — it is a side-effecting state mutation, not artifact generation.

### `tick_task` direct tool

A small custom tool that flips the Nth `<li>` in `tasks.html` from unchecked to checked. The persona currently does this via raw `edit`; with the *"no raw Write / Edit on artifact files"* rule, this becomes a tool.

Parameters: `piece_index: number` (1-indexed position in the checklist).

Behavior: read the active project's `tasks.html`, find the Nth `<li>` in the checklist, replace its `class="..."` to mark it done (the exact CSS class follows whatever the tasks.html template uses — the implementer reads the template and matches it).

Returns: short confirmation string.

This is a state mutation, not generation, so it lives in the persona's tool kit alongside `set_creating` and `set_project_name`.

### Recursion depth limit

`spawn_subagent` reads `GUIDE_SUBAGENT_DEPTH` from the environment. The persona runs at depth 0 (no env var or `0`). When `spawn_subagent` launches a sub-agent, it sets `GUIDE_SUBAGENT_DEPTH=1` in the sub-agent's env. If a sub-agent at depth 1 itself calls `spawn_subagent`, the new launch sets depth to 2. A `spawn_subagent` call at depth ≥ 2 short-circuits with `{ outcome: "blocked", message: "recursion depth limit reached" }` rather than launching a new sub-agent.

For v0 we expect this limit to be untouched in normal flows (persona → sub-agent → done). The depth-2 ceiling exists to leave room for future patterns (e.g., a coding sub-agent spawning a verification sub-agent) without committing to unbounded recursion.

### Model selection

Sub-agents default to `claude-sonnet-4-6`. Pi.dev's `createAgentSession` accepts a model parameter; the deep module passes Sonnet. If a future skill needs Opus (none anticipated for v0), the skill's frontmatter can declare a model override and the deep module reads it.

The persona itself stays on Opus 4.7.

### Dangling-tool-call recovery extension

The recovery module landed in commit `80ea7b7` synthesizes per-tool failure results for `start_task` and `verify_slice`. It needs extension for `spawn_subagent`:

- Inspect the dangling toolCall's `args.response_schema`.
- For `task_outcome` → synthesize `{ outcome: "failure", message: "Previous run was interrupted before finishing this piece." }`.
- For `verify_result` → synthesize `{ ok: false, message: "Previous run was interrupted before finishing the build check." }`.
- For `artifact_write` → synthesize `{ outcome: "failure", message: "Previous run was interrupted before finishing this artifact.", path: "" }`.
- Schema absent / unknown → fall back to generic `isError: true` text result.

The existing `start_task` / `verify_slice` synthesis paths can be removed once those tool surfaces are retired; the `spawn_subagent` synthesis subsumes them. Tests in `dangling-tool-recovery.test.ts` extend accordingly.

### Skill-name validation as a literal union

Both `skill_name` and `response_schema` are TypeBox literal unions, not free-form strings. Pi.dev validates tool-call parameters against the schema before dispatch; a typo (`"wrtie-plan"`) produces a tool-call rejection that the persona observes and corrects, rather than reaching the deep module and returning `blocked`. This is a defense-in-depth: the deep module still handles unknown-skill cases (in case the union grows out of sync with loaded skills), but the common case is caught earlier.

When a new skill is added, the literal union in `spawn_subagent`'s parameters needs to be updated. Worth a comment in `cairn-tools.ts` calling this out.

## Testing Decisions

### What gets tested

- **`spawn-subagent.ts` deep-module mapping** — pure-function tests for each `response_schema` × pi.dev terminal-state combination. Reuses the test pattern from `start-task.test.ts`. The mapping is the most behavior-shaping pure function in this slice.
- **Skill-not-found path** — `spawn_subagent` with an unregistered skill name returns `{ outcome: "blocked", message: "skill <name> not found" }`. Pure-function-testable against a fake skill registry.
- **Recursion depth gating** — env-var-gated test verifying `spawn_subagent` short-circuits at depth ≥ 2 without launching a sub-agent.
- **`tick_task` correctness** — given a hand-crafted `tasks.html` with N items, `tick_task(k)` flips exactly the `k`-th item and leaves the others alone. Includes the boundary cases: `k = 1`, `k = N`, `k > N` (should return a structured failure or no-op).
- **Dangling-tool-call recovery for `spawn_subagent`** — extend `dangling-tool-recovery.test.ts` with cases keyed off `response_schema` (one test per schema literal).
- **`spawn_subagent` tool wiring (sidecar protocol)** — using the `GUIDE_FAKE_*_RESULT` pattern, assert that a faked sub-agent result flows through the tool to the persona's view as the expected structured response. Keep this test driven by env override only — *no real-LLM calls in the test suite* (per the test cleanup landed in `9e42080`).
- **Schema-mismatch normalization** — sub-agent returns text that does not parse to the expected schema → tool returns a normalized `failure` outcome. Pure-function test against canned strings.

### Prior art

- `sidecar/tests/start-task.test.ts` — terminal-state mapping pattern for pi.dev sub-agent results.
- `sidecar/tests/dangling-tool-recovery.test.ts` — pure-function recovery synthesis pattern; extension is mechanical.
- `sidecar/tests/cairn-tools.test.ts` — custom-tool registration assertions; the new `spawn_subagent` and `tick_task` tools follow the same pattern.

### Tests deliberately not written

- **End-to-end real-LLM tests of skill output content.** The skill HTML / markdown is the persona's responsibility; pinning it down breaks every prompt edit. Real-LLM tests were deliberately removed in `9e42080`; this slice does not reintroduce them.
- **Per-skill prompt-content tests.** A skill's instructions are prose; testing prose word-for-word against assertions has poor signal-to-noise.
- **Cost / token telemetry tests.** Worth instrumenting eventually; out of scope for v0.
- **Recursion-depth integration test that actually spawns nested sub-agents.** The pure-function gating test covers the logic; running real pi.dev sessions recursively in CI buys little for the cost.

## Out of Scope

- **Recursion depth beyond 2.** If a real use case for depth 3+ emerges, revisit; v0 caps at 2.
- **Streaming sub-agent progress to the persona's chat during a run.** Same deferral as PRD 06. The chat surface stays silent for the duration of a sub-agent run; the panel's `set_creating` indicator covers the visible side. The persona drops one short line before, one short line after.
- **Telemetry / cost dashboards / per-sub-agent cost reporting.** Worth having; out of scope.
- **Replacing the persona's raw access to `bash`, `read`, `grep`, `find`, `ls`.** Those stay available for inspection / debugging / reading skill content. The *"no raw Write / Edit on artifact files"* rule applies only to the artifact paths.
- **Migrating in-flight user projects mid-conversation.** Existing artifacts in user projects stay valid; only future generation uses `spawn_subagent`. No migration step.
- **A fake LLM provider for tests.** Discussed as the long-term replacement for the deleted LLM-driven protocol tests; out of scope here.
- **Updating the persona prompt to reference all the new skills before they exist.** Persona prompt changes ride alongside the skill-creation work to avoid the partial-landing problem we hit in slice 06 (persona referencing tools that did not yet exist).

## Further Notes

- **Sequencing.** `spawn-subagent.ts` deep module + `spawn_subagent` custom tool is the foundational change; everything else depends on it. After it lands, the existing `start_task` / `verify_slice` retirement is mechanical, the new artifact skills can land in any order, and the persona prompt update is the last step — it is the switch that activates the new path. The dangling-tool-call recovery extension should land *before* the persona prompt switch to avoid windows where an interrupt leaves the session in an unrecoverable state.

- **Risk: cost-savings claim.** Sonnet sub-agents are cheaper per token than Opus, but each sub-agent eats fixed overhead (system prompt + tool definitions + the artifact's own conversation). For brief.html (~5 KB) and full PRDs (~5–10 KB), savings are likely meaningful. For a small `tasks.html` initial write (~1 KB), the overhead might dominate. Worth instrumenting after the slice lands.

- **Risk: response_schema drift.** If the persona's call-site `response_schema` does not match what the skill produces, validation fails and the persona retries with the same wrong schema → same failure → `blocked`. Mitigation: schemas are a small fixed enum (`task_outcome` / `verify_result` / `artifact_write`); the persona prompt names the schema explicitly per call; skills declare their output schema in frontmatter. If they all agree, drift is impossible.

- **Risk: skill-as-string typos.** Mitigated by the literal-union parameter; pi.dev's TypeBox validator rejects unknown literals at tool-dispatch time. Defense-in-depth: the deep module handles unknown skills as `blocked`, but should be rare.

- **The `set_project_name` tool.** Stays as a direct persona tool — it is a side-effecting state mutation tied to the panel surface, not artifact generation. Same category as `set_creating` and the new `tick_task`.

- **Path layout note** (carried from PRD 06). This slice continues to use `<project>/prds/` and `<project>/issues/` at the project root, matching the post-`66e8853` paths and the ADR 0003 amendment landed in `faa92f4`.

- **Skill naming convention.** The dispatcher / writer split shows up cleanly in skill names: `write-*` skills produce a file at a known path; `implement-*` and `verify-*` skills do work without producing a single canonical file. The `response_schema` follows from this — `write-*` skills return `artifact_write`; `implement-*` returns `task_outcome`; `verify-*` returns `verify_result`. Future skills are easy to slot in.
