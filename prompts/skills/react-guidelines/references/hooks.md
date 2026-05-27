# Hooks: Extraction, Construction, and Memoization

## §1 — When to extract a custom hook

Custom hooks extract **stateful logic** (state + handlers + derived values that operate together)
out of a component. The component keeps the JSX; the hook keeps the behavior.

### Trigger 1: Multiple useState calls + handlers form a cohesive cluster
If you have related `useState` calls and handler functions that operate on them together,
and these are all serving the same purpose — extract them into a named hook.

```tsx
// BEFORE — selection logic mixed in with 200 lines of other component logic
function ProductPage({ products }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setLastSelectedId(id);
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  };
  const selectedProducts = products.filter(p => selectedIds.has(p.id));
  // ... 150 lines of JSX
}

// AFTER — selection concern extracted
function ProductPage({ products }) {
  const selection = useMultiSelect();
  const selectedProducts = products.filter(p => selection.selectedIds.has(p.id));
  // ... clean JSX
}
```

### Trigger 2: The same stateful pattern appears in 2+ components
If two components have structurally similar state logic (even if the specifics differ),
extract the pattern into a parameterized hook.

```tsx
// useToggle, useDebounce, useLocalStorage, usePagination, etc.
function useToggle(initial = false) {
  const [isOn, setIsOn] = useState(initial);
  const toggle = useCallback(() => setIsOn(prev => !prev), []);
  return [isOn, toggle] as const;
}
```

### Trigger 3: A component has 4+ useState calls
This is a strong signal that the component manages multiple concerns. Group related
state into hooks by concern:

```tsx
// BEFORE
function InvoiceEditor() {
  const [title, setTitle] = useState('');
  const [lineItems, setLineItems] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // ...
}

// AFTER — state grouped by concern into hooks
function InvoiceEditor() {
  const form = useInvoiceForm();       // title, lineItems, isDirty, validationErrors
  const save = useInvoiceSave(form);   // isSaving, handleSave
  const [showPreview, setShowPreview] = useState(false); // fine inline, it's one thing
  // ...
}
```

### Trigger 4: You want to test stateful logic independently of the UI
Custom hooks can be tested with `renderHook` from `@testing-library/react-hooks`
without needing to render any JSX.

### When NOT to extract a hook

- **A single useState with a simple handler** — `const [isOpen, setIsOpen] = useState(false)`
  does not need its own hook. Inline it.
- **Pure computation** — if there's no state or effect, it's a utility function, not a hook.
  Don't prefix it with `use` and don't put it in a hooks folder.
- **Premature abstraction** — don't extract a hook "in case we need it elsewhere."
  Extract when you hit a trigger, not before.

---

## §2 — Hook construction rules

- **Return a tuple for 2 values** (mirrors `useState`), **named object for 3+.**
- **Dependencies are explicit parameters.** A hook receives what it depends on as arguments.
  Calling other hooks inside (`useStore`, `useQuery`) is fine — that's composition.
- **Name after what the hook manages, not what it does.**
  `useInvoiceForm` ✅, `useHandleFormSubmit` ❌, `useFetchAndSetMessages` ❌.
- **One concern per hook.** A hook managing both form state AND save logic is doing two things.
  Split into `useInvoiceForm` (state, validation) and `useInvoiceSave` (mutation).

For where hook files live in the project, see `file-structure.md §1`.

---

## §3 — Memoization: useMemo, useCallback, React.memo

### The default is NO memoization

Do not add `useMemo`, `useCallback`, or `React.memo` by default.
Add them only when one of the specific conditions below is met.

React re-renders are cheap. The overhead of memoization (comparing deps, storing previous
values, more complex mental model) is often worse than the re-render it prevents.

### When to use `useMemo`

**Condition 1: The computation is genuinely expensive (>1ms) and you've measured it.**
Use React DevTools Profiler. If a render takes >16ms and the Profiler points to a specific
computation, wrap that computation in `useMemo`.

```tsx
// Only if filtering 10k+ items is actually slow as measured by Profiler
const filtered = useMemo(
  () => items.filter(item => matchesSearch(item, query)),
  [items, query]
);
```

**Condition 2: You're passing a computed object/array as a prop to a `React.memo`'d child.**
Without `useMemo`, the child gets a new reference every render and `React.memo` is useless.

```tsx
// This object is new every render — breaks React.memo on ExpensiveChild
<ExpensiveChild style={{ color: theme.primary, fontSize: 14 }} />

// Fix: stabilize the reference
const style = useMemo(() => ({ color: theme.primary, fontSize: 14 }), [theme.primary]);
<ExpensiveChild style={style} />
```

**Condition 3: The value is a dependency of another hook's dependency array.**
If a computed value appears in a `useEffect` or `useCallback` dependency array, unstable
identity causes those hooks to re-run. Stabilize with `useMemo`.

### When to use `useCallback`

`useCallback` is `useMemo` for functions. Same conditions apply — only use it when the
function reference matters.

**Condition 1: The callback is passed to a `React.memo`'d child.**
```tsx
// Without useCallback, handleClick is new every render → memo is useless
const handleClick = useCallback((id: string) => {
  setSelectedId(id);
}, []);

<MemoizedList items={items} onItemClick={handleClick} />
```

**Condition 2: The callback is a dependency of a useEffect.**
If an effect depends on a callback prop or a function you defined, stabilize it
with `useCallback` to prevent the effect from re-running.

### When to use `React.memo`

Wrap a component in `React.memo` when **all** of these are true:
1. The component re-renders often due to parent re-renders (not its own state changes)
2. The re-render is expensive (renders many DOM nodes, or contains expensive computation)
3. The props it receives are stable (primitives, or memoized objects/callbacks)

If any of these is false, `React.memo` either won't help or will add overhead checking
props for no benefit.

```tsx
// GOOD use of React.memo — expensive list item, parent re-renders often
const InvoiceRow = React.memo(function InvoiceRow({ invoice, onSelect }) {
  // renders 20+ cells with formatting
  return <tr>...</tr>;
});
```

### Common memoization mistakes to avoid

**Mistake 1: Memoizing a value only used in JSX, no memo'd children**
```tsx
// POINTLESS — no React.memo child cares about this reference
const label = useMemo(() => `${first} ${last}`, [first, last]);
return <span>{label}</span>;

// Just compute it
const label = `${first} ${last}`;
```

**Mistake 2: Creating an object inline in JSX and passing it to a memo'd child**
```tsx
// React.memo on Child is USELESS — config is new every render
<MemoizedChild config={{ a: foo, b: bar }} />

// Either: useMemo the config
const config = useMemo(() => ({ a: foo, b: bar }), [foo, bar]);
<MemoizedChild config={config} />

// Or: pass individual props (often simpler)
<MemoizedChild a={foo} b={bar} />
```

**Mistake 3: useCallback with no memo'd consumer**
```tsx
// POINTLESS — no child is memo'd, so stabilizing the reference does nothing
const handleClick = useCallback(() => setOpen(true), []);
return <button onClick={handleClick}>Open</button>;

// Just inline it
return <button onClick={() => setOpen(true)}>Open</button>;
```

### Summary decision table

| Situation | Use memo? | Mechanism |
|-----------|-----------|-----------|
| Simple derived string/number | No | Inline computation |
| Expensive computation (measured) | Yes | `useMemo` |
| Object/array prop to `React.memo` child | Yes | `useMemo` |
| Callback prop to `React.memo` child | Yes | `useCallback` |
| Callback prop to regular (non-memo'd) child | No | Inline arrow function |
| Callback used in useEffect dependency array | Yes | `useCallback` |
| Component re-renders often from parent, is expensive | Yes | `React.memo` on component |
| Component re-renders from its own state | No | `React.memo` won't help |

