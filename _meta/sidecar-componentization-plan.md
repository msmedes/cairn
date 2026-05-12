# Sidecar Componentization Plan

## Goal

Refactor `sidecar/` from a flat collection of TypeScript modules into a clearer module structure while preserving current behavior and public entrypoints.

## Initial Inspection

- `sidecar/package.json` exposes `index.ts` as the package `main` and only defines `bun test` locally.
- Root scripts call sidecar through:
  - `bun run typecheck` -> `tsc -p sidecar/tsconfig.json --noEmit`
  - `bun run test:sidecar` -> `cd sidecar && bun test`
- `sidecar/tsconfig.json` currently includes `index.ts` and `tests/**/*`; imported modules are typechecked through those roots.
- Tests currently live under `sidecar/tests/` and map one-to-one to most sidecar files. Keep this convention for Bun integration tests, but organize test filenames around the new module ownership.
- `sidecar/index.ts` is the largest mixed-responsibility file. It owns wire protocol types, stdio dispatch, runtime session state, project opening, session event translation, dev-log replay, and faux protocol models for tests.
- Existing cohesive domains already visible in the flat tree:
  - artifacts and tool parameter schemas: `brief-artifact.ts`, `plan-artifact.ts`, `tasks-artifact.ts`, `artifact-tool-params.ts`, `tool-schema.ts`
  - project storage/context: `cairn-dir.ts`, `project-store.ts`, `recents-registry.ts`, `project-context.ts`, `project-locator.ts`, `project-phase.ts`, `legacy-migrator.ts`
  - protocol/session handling: `index.ts`, `hydrate.ts`, `init-recap.ts`, `resume-recap.ts`, `recap-trigger.ts`, `dangling-tool-recovery.ts`
  - MCP/pi integration: `pi-extensions.ts`, `pi-mcp-adapter-wrapper.*`, `mcp-auth.ts`
  - subagent orchestration: `spawn-subagent.ts`, `start-task.ts`, `verify-slice.ts`
  - utilities: `slug.ts`, `env.ts`

## Quality Bar

Follow `/quality-code`:

- Preserve strict TypeScript coverage.
- Move boundary schemas/types with the module that owns their runtime validation.
- Prefer existing Zod-derived types over duplicated interfaces.
- Keep tests real and behavior-oriented; do not add tests that only restate Zod validation.
- Avoid abstractions that only make folders look symmetrical.

No Rust/Tauri bridge changes are expected. If that changes, use `/rust-guidelines` before touching Rust.

## Target Structure

```text
sidecar/
  index.ts
  package.json
  tsconfig.json
  bun.lock
  bunfig.toml
  artifacts/
    artifact-tool-params.ts
    brief-artifact.ts
    plan-artifact.ts
    tasks-artifact.ts
    tool-schema.ts
  config/
    env.ts
  integrations/
    mcp-auth.ts
    pi-extensions.ts
    pi-mcp-adapter-wrapper.d.ts
    pi-mcp-adapter-wrapper.js
  project/
    cairn-dir.ts
    legacy-migrator.ts
    project-context.ts
    project-locator.ts
    project-phase.ts
    project-store.ts
    recents-registry.ts
  protocol/
    hydrate.ts
    init-recap.ts
    recap-trigger.ts
    resume-recap.ts
  recovery/
    dangling-tool-recovery.ts
  runtime/
    agent-threads.ts
    faux-protocol-models.ts
    session-events.ts
  subagents/
    spawn-subagent.ts
    start-task.ts
    verify-slice.ts
  utils/
    slug.ts
  tests/
    artifacts/
    integrations/
    project/
    protocol/
    recovery/
    subagents/
    utils/
```

`index.ts` remains the public executable entrypoint used by Tauri/package metadata. It should become a thin runtime composition layer, not disappear.

## Execution Steps

1. Commit this plan before moving files.
2. Run baseline verification:
   - `bun run lint`
   - `bun run typecheck`
   - `bun run test:sidecar`
   - `bun run test`
   - `bun run build`
3. Make a mechanical move commit:
   - move cohesive flat files into the target domain folders
   - move matching tests into matching `sidecar/tests/*/` folders
   - update imports directly, without barrel files
   - update `sidecar/tsconfig.json` only as needed to preserve coverage
4. Verify after the mechanical move with the same command set.
5. Extract only the highest-value pieces from `index.ts`:
   - `runtime/agent-threads.ts` for persisted parent/subagent thread reconstruction and replay helpers
   - `runtime/faux-protocol-models.ts` for test-only faux model selection
   - `runtime/session-events.ts` only if the event wiring can be moved without hiding state transitions
6. Keep extraction commits behavior-preserving. If a bug or behavior change is discovered, fix it in a separate commit with a focused explanation.
7. Verify after each meaningful extraction.
8. Push the branch and open a PR.
9. Dispatch two subagent reviews before merge:
   - `/quality-code` review for TypeScript quality and regression risk
   - sidecar architecture/module-boundary review
10. Address review findings in follow-up commits, rerun full verification, push, and merge only when clean.
11. Return the local checkout to clean `main`.

## Completion Audit

- Show before/after `sidecar/` trees at a useful depth.
- Confirm `sidecar/` is no longer a flat pile of unrelated modules.
- Confirm all required verification commands passed.
- Confirm PR URL, commits, subagent review results, and merge status.
