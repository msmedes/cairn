# Component Design Rules

## §1 — When to split a component

Do NOT split preemptively. Write the component first, then split when any of these 5 triggers is met.
These are hard triggers — if any one is true, split.

### Trigger 1: Multiple unrelated state clusters
If a component has 2+ `useState` calls that never appear in the same handler or JSX expression, they are unrelated state. Extract each cluster into its own component or custom hook.

```tsx
// BAD — two unrelated state clusters in one component
function Dashboard() {
  const [filters, setFilters] = useState({});        // cluster A
  const [isModalOpen, setIsModalOpen] = useState(false); // cluster B
  // filters and isModalOpen never interact
}

// GOOD — split into separate components
function Dashboard() {
  return (
    <>
      <FilterBar />   {/* owns filters state */}
      <CreateModal />  {/* owns isModalOpen state */}
    </>
  );
}
```

### Trigger 2: List items with per-item state
If you render a list and each item has its own state (selected, expanded, editing, hover), the item MUST be its own component. Never manage per-item state in the parent via index lookups.

```tsx
// BAD — parent tracks per-item state via Map/object
function TaskList({ tasks }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return tasks.map(t => (
    <div onClick={() => setExpanded(prev => ({ ...prev, [t.id]: !prev[t.id] }))}>
      {expanded[t.id] && <Details task={t} />}
    </div>
  ));
}

// GOOD — each item owns its own state
function TaskList({ tasks }) {
  return tasks.map(t => <TaskItem key={t.id} task={t} />);
}

function TaskItem({ task }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div onClick={() => setExpanded(prev => !prev)}>
      {expanded && <Details task={task} />}
    </div>
  );
}
```

Exception: if the parent must enforce single-selection (only one item expanded at a time), the parent owns the `activeId` state and passes `isActive` + `onSelect` as props to each item. The item component still exists — it just becomes controlled.

### Trigger 3: The component cannot be named in ≤3 words
If you cannot name the component with a clear noun or noun-phrase (e.g., `InvoiceRow`, `UserAvatar`, `SearchFilterBar`), it is doing too many things. Split until each piece has an obvious name.

### Trigger 4: JSX exceeds ~80 lines
This is a soft threshold, but if the returned JSX is longer than ~80 lines, look for visual sections that map to separate concerns. Each section that could have its own heading in a design mockup is a candidate for extraction.

### Trigger 5: You need to reuse part of it
If any part of the JSX or logic is needed in a second location, extract it immediately. Do not copy-paste.

---

## §2 — State ownership ladder

For every piece of state, walk this ladder from top to bottom. Stop at the first level that works.

### Level 1: Derived (no state at all)
If a value can be computed from existing props or state, compute it during render. No `useState`, no `useMemo` unless profiling shows a bottleneck. See `hooks.md §3` for memoization rules.

```tsx
// BAD
const [fullName, setFullName] = useState('');
useEffect(() => setFullName(`${first} ${last}`), [first, last]);

// GOOD
const fullName = `${first} ${last}`;
```

### Level 2: Local state (`useState` in the component that uses it)
If the state is used only by this component and its direct children, keep it here. This is the default.

### Level 3: Lifted state (parent owns, passes via props)
If two sibling components need to read or write the same state, lift it to their closest common parent. Pass value + setter/callback as props. This is normal React — do this freely for 1-2 levels of depth.

### Level 4: Composition (restructure the tree)
If you are passing props through an intermediate component that doesn't use them, restructure via composition before reaching for a store. See `composition.md`.

### Level 5: Zustand store
If state is shared beyond direct parent-child, changes frequently, or is needed by distant/unrelated components, use a Zustand store. This is the default for shared mutable state. See `zustand.md`.

Note: React Context is **not** on this ladder for state management. Context is for dependency
injection of stable references (theme objects, client instances, store instances). If the value
changes and consumers need to re-render efficiently, use Zustand. See `zustand.md §1`.

---

## §3 — Controlled vs. uncontrolled

Default to uncontrolled (component owns its state). Make a component controlled
(`value` + `onChange` props) only when the parent needs to read, reset, or coordinate
that state with siblings.

---

## §4 — Prop hygiene rules

### Rule 4a: No optional props on single-use components
If a component is used in exactly one place, every prop must be required. Optional props imply multiple usage contexts that don't exist — they add dead code paths and make the component harder to understand.

When refactoring: search the codebase for usages. If there's only one call site, remove all optional markers and default values. If the component is used in 2+ places with different prop combinations, optional props are fine.

### Rule 4b: Max 7 props before restructuring
If a component takes more than 7 props, one of these is true:
- It's doing too much → split the component (§1)
- You're tunneling props through intermediaries → use composition (`composition.md`)
- Several related props should be a single domain object that already exists in your data model (e.g., pass `user` instead of `userName`, `userEmail`, `userAvatar`)

**Important caveat on grouping props:** Only group props into an object when that object is a
pre-existing entity from your data layer (a user, an invoice, a product). Never create
a new synthetic object just to reduce prop count — this creates a new object reference on
every render, which breaks `React.memo` on child components and can make re-render performance
*worse*, not better. If you find yourself writing `config={{ a, b, c }}` inline at the call
site, you've made things worse. See `hooks.md §3` for the memoization implications.

### Rule 4c: No prop tunneling
If a component receives a prop only to pass it unchanged to a child, that's tunneling. Fix via:
1. Composition (pass the child as `children` — see `composition.md`)
2. Zustand store (see `zustand.md`)

### Rule 4d: Naming and polarity
- Callback props use past-tense event names: `onItemSelected`, `onFilterChanged`. Never imperative: `doSubmit`, `updateFilter`.
- Boolean props are always positive: `isOpen`, `isLoading`, `hasError`. Never negative: `isNotReady`, `hideHeader`.
