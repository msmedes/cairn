---
name: react-guidelines
disable_model_invocation: false
description: >
  Use when designing, writing, reviewing, or refactoring React components and features.
  Covers component boundaries, state ownership, composition, prop design, custom hooks,
  useEffect avoidance, memoization, Zustand, TanStack Query, loading/error/empty states,
  async event handling, TypeScript state modeling, and file organization. Trigger for
  React component design questions, component-tree restructuring, state management choices,
  data fetching, effect cleanup, reusable UI composition, prop drilling, render performance,
  error boundaries, optimistic updates, double-submit prevention, race conditions, or
  organizing a React codebase.
---

# React Component Patterns

This skill contains prescriptive, deterministic rules for writing and refactoring React components.
The rules are designed so that two people following them independently produce structurally
similar output.

## How to use this skill

This skill has two modes: **writing** and **refactoring**.

### Writing mode
When creating new components or features, read these references **before writing code**:

1. Read `references/component-design.md` — decides component boundaries and state ownership
2. Read `references/effects.md` — prevents useEffect misuse before it starts
3. Read `references/hooks.md` — when and how to extract custom hooks, plus memoization rules
4. Read `references/typescript-patterns.md` — state modeling, prop types, making invalid states unrepresentable
5. Read whichever of these apply to the task:
   - `references/zustand.md` — if state is shared beyond direct parent-child props
   - `references/tanstack-query.md` — if server data is involved
   - `references/composition.md` — if building flexible/reusable UI
   - `references/error-handling.md` — if the component displays data (loading/error/empty states)
   - `references/async-patterns.md` — if the component has buttons/forms that trigger async work
6. Read `references/file-structure.md` — determines where files go

### Refactoring mode
When reviewing or refactoring existing components, read:

1. `references/refactoring-checklist.md` — the ordered pass list pointing to specific reference files
2. Then read whichever reference files the checklist flags as relevant

### Quick decision reference

| Question | Answer | Reference |
|----------|--------|-----------|
| Should I break this component up? | See the 5 concrete triggers | component-design.md §1 |
| Where does this state live? | Follow the state ownership ladder | component-design.md §2 |
| Should I use Zustand here? | Yes if state is shared beyond direct parent-child | zustand.md §1 |
| Should I use React Context? | Only for dependency injection (static values) | zustand.md §1 |
| Should I use TanStack Query? | Yes if data comes from a server | tanstack-query.md §1 |
| Should I use the generated API clients? | Yes, always for agent-framework/crud-service/dataflow endpoints | tanstack-query.md §2 |
| Can I use useEffect here? | Only for external system sync | effects.md §1 |
| Should I extract a custom hook? | See the 4 triggers | hooks.md §1 |
| Should I useMemo/useCallback? | Only when passing to memoized children or measured perf issue | hooks.md §3 |
| Should this prop be optional? | Only if component is used in 2+ places | component-design.md §4 |
| How do I handle loading/error states? | error → loading → empty → data, always | error-handling.md §1 |
| How do I model this state in TypeScript? | Discriminated union if 3+ modes | typescript-patterns.md §1 |
| How do I prevent double-submit? | `mutation.isPending` disables the button | async-patterns.md §1 |
| Should I use optimistic updates? | Only if latency matters AND >99% success rate | async-patterns.md §2 |
| Where does this file go? | Follow the file placement rules | file-structure.md §1 |
