# Refactoring Checklist

For each pass: scan the files in scope, look for the pattern, follow the link to fix it.
Fix findings before moving to the next pass.

---

## Pass 1: useEffect audit

For every `useEffect`, ask: **"Is this synchronizing with an external system?"**

- **No** → Open `effects.md §2` and match the pattern to find the rewrite.
- **Yes** → Confirm it has a cleanup function. If the effect + its state is >8 lines,
  extract into a custom hook per `hooks.md §1`.

---

## Pass 2: State ownership audit

For every `useState`, ask these in order (stop at first "yes"):

| Question | Fix | Reference |
|----------|-----|-----------|
| Can this be computed from other state/props? | Delete, compute inline | `component-design.md §2` |
| Is this populated from an API response? | Replace with TanStack Query | `tanstack-query.md §6` |
| Is this shared with siblings? | Lift to parent, pass via props | `component-design.md §2` |
| Is this tunneled through a non-consuming intermediate? | Restructure via composition | `composition.md §1` |
| Is this shared with distant/unrelated components? | Move to Zustand store | `zustand.md §1` |
| Is this in a Context that changes frequently? | Move to Zustand store | `zustand.md §1` |

---

## Pass 3: Component splitting audit

Check each trigger from `component-design.md §1`:

| What to look for | Trigger |
|-------------------|---------|
| 2+ `useState` calls whose values never interact | Trigger 1: unrelated state |
| `.map()` + Record/Map for per-item state tracking | Trigger 2: list items |
| Can't name the component in ≤3 words | Trigger 3: naming |
| Returned JSX >80 lines | Trigger 4: length |

---

## Pass 4: Hook extraction audit

Check triggers from `hooks.md §1`:

| What to look for |
|-------------------|
| Multiple related useState calls + handlers serving the same purpose |
| 4+ useState calls — component manages multiple concerns inline |
| Same state logic duplicated in 2+ components |

---

## Pass 5: Prop hygiene audit

| What to look for | Rule |
|-------------------|------|
| `prop?:` or `prop = default` with only 1 call site | `component-design.md §4a` |
| More than 7 non-children props | `component-design.md §4b` |
| Component receives a prop only to forward it | `component-design.md §4c` |
| Imperative callback names (`doSubmit`) or negative booleans (`hideX`) | `component-design.md §4d` |

---

## Pass 6: Memoization audit

For every `useMemo`, `useCallback`, and `React.memo`, apply `hooks.md §3`:

| What to look for | Fix |
|-------------------|-----|
| `useMemo` where value only appears in JSX, no memo'd children | Remove, compute inline |
| `useCallback` where callback isn't passed to a `React.memo`'d child or used in an effect dep | Remove, inline the function |
| Object/array created inline and passed to `React.memo`'d child | Add `useMemo`, or pass individual props |
| `React.memo` on component that re-renders from its own state or has unstable props | Remove `React.memo` |

---

## Pass 7: Data source audit

Combines data fetching and Zustand store review.

**Data fetching** — apply `tanstack-query.md`:

| What to look for | Fix |
|-------------------|-----|
| Raw `fetch()`/`axios` in a component | Extract to `api.ts`, wrap in query hook in `queries.ts` (§3) |
| API data stored in `useState` | Replace with `useQuery` return value (§6) |
| Manual cache invalidation logic | Use `invalidateQueries` in mutation `onSuccess` (§4) |
| Variable used in `queryFn` but missing from `queryKey` | Add it to `queryKey` — this is a bug (§2) |

**Zustand stores** — apply `zustand.md`:

| What to look for | Fix |
|-------------------|-----|
| Store holding API response data | Move to TanStack Query (§5) |
| Single store with unrelated state domains | Split into per-feature stores (§2) |
| Destructuring entire store: `const { a, b } = useStore()` | Use individual selectors (§2) |
| `useEffect(() => store.setState(props))` | Use scoped store pattern (§3) |
| Store used for parent-child communication | Remove store, use props (§5) |

---

## Pass 8: Correctness audit

Combines error handling and TypeScript state safety.

**Error handling** — apply `error-handling.md`:

| What to look for | Fix |
|-------------------|-----|
| Component renders `data` without checking `error`/`isLoading` first | Add error → loading → empty → data order (§1) |
| Inline `<p>Loading...</p>` instead of shared components | Use `<Spinner />`, `<ErrorBanner />`, `<EmptyState />` (§1) |
| Page or widget with no error boundary ancestor | Add route-level and/or widget-level boundary (§2) |
| `mutate()` with no `error` rendered and no `onError` callback | Add inline error or toast (§3) |
| `default:` case that does nothing or returns `null` silently | Add `assertNever` or `reportUnexpectedValue` (§4) |
| API/URL/localStorage data used without validation | Validate at data boundary with fallback (§4) |

**TypeScript safety** — apply `typescript-patterns.md`:

| What to look for | Fix |
|-------------------|-----|
| Independent boolean state (`isLoading` + `error` + `data`) for non-query async | Discriminated union (§1) |
| `switch` on discriminated union without `assertNever` in default | Add `default: return assertNever(value)` (§2) |
| Callback prop takes `React.ChangeEvent` instead of domain value | Translate event inside component, expose domain type (§3) |

---

## Pass 9: Async safety audit

For every event handler that does async work, apply `async-patterns.md`:

| What to look for | Fix |
|-------------------|-----|
| Submit/save button not disabled during `isPending` | Disable with `mutation.isPending` (§1) |
| `useState(false)` flag toggled around `fetch` instead of `useMutation` | Replace with `useMutation` (§1) |
| Optimistic update without `onError` rollback | Add full `onMutate`/`onError`/`onSettled` pattern (§2) |
| Optimistic update on failure-prone action (create/delete/complex form) | Remove optimistic update, use standard mutation (§2) |

---

## Pass 10: File structure audit

Scan the file tree and import graph, apply `file-structure.md`:

| What to look for | Fix |
|-------------------|-----|
| Files imported by 0 other files | Delete (§6) |
| Component imported by only 1 file, not in `internal/` | Move to `internal/` (§3) |
| `index.ts` barrel files re-exporting | Remove barrel, use direct imports (§2) |
| File exports 2+ React components | Split into one-component-per-file (§4) |

---

## Priority order

1. **useEffect** — eliminates the most bugs
2. **State ownership** — ensures correct data flow
3. **Component splitting** — improves readability
4. **Hook extraction** — reduces component size
5. **Prop hygiene** — reduces coupling
6. **Memoization** — removes incorrect optimization
7. **Data sources** — centralizes state management
8. **Correctness** — catches error handling gaps and type-level bugs
9. **Async safety** — prevents double-submit and race conditions
10. **File structure** — enforces boundaries
