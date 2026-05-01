# PRD — Slice 08: Schema-validated artifact data

## Problem Statement

The Guide's core user-visible artifacts are currently model-generated HTML documents. That makes the panel depend on agent-authored markup, lets presentation drift into prompts, and forces the app to parse generated documents back into renderable state. The Tasks tab compounds the problem by tracking progress through list position and HTML mutation rather than durable task identity.

The user wants the Guide and Sub-agents to provide artifact content through schema-validated tool calls, while the app owns the actual presentation for Brief, Plan, and Tasks.

## Solution

The user-visible Project, Plan, and Tasks tabs become dedicated app-rendered surfaces backed by schema-validated JSON artifacts. The Guide or a Sub-agent supplies structured content through custom tools; the tool validates and persists it; the React app renders it through fixed components. Existing HTML artifact support can be removed rather than migrated.

Each Project also gains a hidden project context file that captures durable facts, terms, constraints, and decisions for the Guide and Sub-agents. It is created alongside the Brief through an explicit tool call, not as a side effect of artifact creation.

## User Stories

1. As a project owner, I want Brief, Plan, and Tasks content to be schema-validated before it is saved, so that malformed model output does not become panel state.
2. As a project owner, I want the app to own artifact presentation, so that visual consistency does not depend on prompt-written HTML and CSS.
3. As the Guide, I want custom artifact tools for creating and updating the Brief and Plan, so that I can respond to user corrections without raw file edits.
4. As a Sub-agent, I want artifact-writing skills to finish by calling custom tools, so that I can generate content while the app controls persistence.
5. As a user, I want the Brief tab to keep showing a clear project summary, so that the artifact format change does not degrade the visible experience.
6. As a user, I want the Plan tab to keep summarizing the agreed first slice in plain language, so that I can understand what will be built before implementation starts.
7. As a user, I want the Tasks tab to show each piece as todo, in progress, done, or blocked, so that implementation progress is more informative than a binary checklist.
8. As a project owner, I want Tasks keyed by issue-derived slugs, so that progress updates target durable work items rather than fragile list indexes.
9. As the Guide, I want a narrow task-status update tool, so that routine implementation progress cannot accidentally rewrite the whole checklist.
10. As the Guide, I want Brief and Plan update tools to require a reason, so that user-visible agreement changes are intentional and auditable.
11. As a Sub-agent, I want a project context file in the Project root, so that durable terms, constraints, and decisions are easy to discover before doing work.
12. As a user, I do not want to see raw project context, PRDs, issues, or schema files in the panel, so that engineering scaffolding stays out of the experience.
13. As a project owner, I want no compatibility layer for broken local HTML-era projects, so that this slice can simplify the system rather than preserve bad states.
14. As a developer, I want tests around the artifact modules and tools, so that schema validation, persistence, and phase derivation are covered without relying on model behavior.

## Implementation Decisions

- Add deep artifact modules for Brief, Plan, and Tasks. Each module owns its artifact schema, validation, envelope stamping, persistence, loading, and update semantics behind a small interface.
- Persist artifact state as JSON with a tool-owned envelope and artifact-specific data. Metadata such as schema version and update timestamp is assigned by code, not supplied by the model.
- Use one schema per artifact type. Do not introduce a generic document-block schema for the core user-visible surfaces.
- Replace model-generated HTML artifact writes with custom tools. The public tool surface has separate create/update operations for Brief and Plan, a create operation for Tasks, and a slug-based task-status update operation for routine progress.
- Brief and Plan update operations require a short reason. Creation operations do not.
- Tasks use issue-derived slugs as durable identifiers and a status enum of todo, in progress, done, and blocked. Routine task updates target slug plus status, not list index.
- Replace the existing index-based task mutation module with a JSON task artifact module. The old tick-by-position behavior is retired.
- Add a project-context module and explicit context update tool. The file uses the same broad CONTEXT.md format as the repo-level context docs and is Engineering scaffolding, not a panel artifact.
- Artifact tools do not update project context automatically. Brief creation and context creation may happen in parallel because they write disjoint targets.
- Refactor the write-brief, write-plan, and write-tasks skills so they generate content and call artifact tools instead of instructing Sub-agents to write files directly.
- Update the Guide persona prompt so raw writes to artifact JSON and project context are forbidden; artifact and context changes happen through tools.
- Update project phase derivation to read the JSON artifacts. The presence of Brief, PRDs, issues, and Tasks status continues to drive phase; HTML no longer participates.
- Update the panel to read JSON artifacts and render dedicated Brief, Plan, and Tasks components. The creating indicator clears from JSON content changes instead of HTML content changes.
- Remove old HTML artifact parsing and slideshow-building from the active Brief/Plan path. Any remaining helper code should be deleted unless another active feature uses it.
- Keep PRDs and issues as Engineering scaffolding. They should align with artifact data, but this slice does not replace those markdown scaffolding files.

## Testing Decisions

- Good tests for this slice exercise external contracts: valid tool input creates canonical JSON, invalid input is rejected with useful structured errors, the panel renders from JSON, and task progress updates by slug.
- Unit-test the deep artifact modules directly for envelope stamping, schema validation, create/update behavior, task status transitions, and missing/unknown slug errors.
- Unit-test project phase derivation against JSON artifacts, including todo/in-progress/blocked versus all-done task sets.
- Unit-test Guide tools with injected active Project state and module fakes where useful, following the existing sidecar tool test pattern.
- Update protocol tests so artifact tool results and task status updates flow through the sidecar boundary.
- Update React tests for Project, Plan, and Tasks rendering from JSON. Keep tests focused on visible behavior, not component internals.
- Add prompt/skill regression checks only where existing tests already inspect prompt text or tool allowlists. Do not try to test model writing quality through unit tests.
- Do not write a migration test from HTML artifacts to JSON because old local projects are explicitly unsupported.

## Out of Scope

- Migrating existing local projects from HTML artifacts. Existing broken projects may stop rendering.
- Partial patch semantics for Brief and Plan updates. v0 uses full replacement through update tools.
- Stable IDs for Brief and Plan sections. They can be added later if partial updates or richer interaction requires them.
- Artifact history, diffing, or rollback. This slice stores canonical current state only.
- Rendering or exposing project CONTEXT.md to the user. The Guide may summarize project context conversationally when useful, but the raw file stays hidden.
- Replacing PRD and issue markdown with JSON. Those remain Engineering scaffolding.
- Provider-specific advanced tool-use examples beyond whatever the current tool definition mechanism can express cleanly. The runtime schema is the enforcement point.

## Further Notes

This slice intentionally reverses earlier HTML artifact assumptions documented in prior PRDs. ADR 0005 is the architectural anchor: agents provide content; tools validate and persist; the app renders.

The sequencing should keep the system usable: land artifact modules and tools first, then update skills/persona, then switch the panel and phase derivation to JSON. The persona prompt switch should be last because it activates the new workflow.
