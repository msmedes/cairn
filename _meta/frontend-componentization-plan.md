# Frontend Componentization Plan

## Goal

Refactor the frontend from a flat `src/` directory into a feature-oriented structure, shrink `App.tsx`, co-locate tests with the files they cover, and preserve current behavior.

## Guidance

- Follow `/react-component-patterns` refactoring mode:
  - Split components when JSX/concerns exceed the concrete triggers.
  - Keep local state local; lift state only to the closest common owner.
  - Use Zustand only if mutable state is shared beyond direct parent-child relationships.
  - Avoid barrel files; use direct imports.
  - Co-locate tests next to implementation files.
- Follow `/quality-code`:
  - Preserve strict TypeScript coverage.
  - Prefer derived types and discriminated unions where useful.
  - Use real tests and existing repo scripts as verification gates.

## Decision: Zustand

Do not add Zustand in the first pass. The current shared state is still app-shell state that coordinates direct child sections (`ChatPane`, `ProjectPanel`, overlays). If extraction exposes distant mutable state or prop tunneling through non-consuming intermediates, introduce a focused feature store then.

## Target Structure

```text
src/
  app/
    App.tsx
    App.test.tsx
    App.css
  components/
    PanelTabs.tsx
    PanelTabs.test.tsx
  features/
    artifacts/
      components/
      *.ts
      *.test.ts
    bug-report/
      components/
      *.ts
      *.test.tsx
    chat/
      components/
      hooks/
      *.ts
      *.test.ts
    dev-mode/
      components/
    project/
      hooks/
    settings/
      components/
    shell/
      components/
      hooks/
  hooks/
    useAutoScroll.ts
    useModalOverlay.ts
  lib/
    tauri.ts
  test/
    setup.ts
```

## Execution Steps

1. Create a dedicated branch and commit this plan.
2. Move existing flat files into the target folders with import updates only.
3. Extract `App.tsx` into focused app-shell components:
   - `ChatPane` for header, messages, recents, and composer.
   - `ProjectPanel` for artifact tab selection, artifact rendering, and placeholders.
   - `PaneDivider` for split resizing UI.
   - small utility helpers for class joining, Tauri runtime detection, status derivation, and image keys.
4. Extract cohesive App state/effects into hooks where the stateful concern is testable:
   - settings/MCP settings bridge.
   - menu-event bridge.
   - bug-report snapshot tracking if it remains non-trivial after component extraction.
5. Keep tests co-located with moved source and add focused tests for any extracted non-trivial hook/helper.
6. Run verification:
   - `bun run lint`
   - `bun run typecheck`
   - `bun run test:frontend`
   - `bun run build`
   - Tauri MCP screenshot/inspection if a running app is available.
7. Push the branch, open a PR, and audit the result against the original request.
