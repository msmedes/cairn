# Zustand Rules

## §1 — Zustand is the default for shared state. Context is not.

### The core principle

React Context is a **dependency injection** mechanism, not a state management tool.
It re-renders every consumer on every change, requires Provider wrappers, and has no
selector support. Zustand at ~1KB fixes all of these problems with less boilerplate.

TkDodo (maintainer of TanStack Query, prominent Zustand advocate) puts it directly:
"Don't use context for state management. Use it for dependency injection only."

### Decision: Where does shared state go?

```
Is this state used only by one component (and maybe its direct children via props)?
├── YES → useState in that component. Done.
│
└── NO → Is this state from a server/API?
    ├── YES → TanStack Query. Not Zustand, not Context. See tanstack-query.md.
    │
    └── NO → Does the state almost never change (theme, locale, feature flags, auth identity)?
        ├── YES → React Context is fine. These are dependency injection, not state management.
        │         Wrap in a Provider, consume with useContext.
        │
        └── NO → Zustand store.
                  This includes: UI state shared across routes, form state spanning pages,
                  user preferences that update, notification queues, sidebar/modal state
                  read by distant components, shopping cart, collaborative state, etc.
```

### Why not Context for changing state?

Context has a fundamental problem: when the Provider value changes, **every** component
that calls `useContext(MyContext)` re-renders, even if it only reads one field from the
context value. There is no selector mechanism. The workaround (splitting into many tiny
Contexts) adds massive boilerplate and defeats the purpose.

Zustand has selectors. A component that reads `useStore(s => s.sidebarOpen)` will only
re-render when `sidebarOpen` changes, not when some other field in the store changes.
This is not a performance micro-optimization — it's the difference between a snappy UI
and a sluggish one once you have 20+ consuming components.

### What Context IS good for

- **Providing a QueryClient** (TanStack Query's `<QueryClientProvider>`)
- **Providing a theme object** that changes once (light/dark toggle, not per-frame animation)
- **Providing a router instance**
- **Providing a scoped Zustand store instance** (see §3 below)
- **Providing auth identity** (user object that changes on login/logout, not every second)

The pattern: the Context value is a **stable reference** (a client, a store instance, a config).
It almost never changes. Consumers subscribe to the injected thing's own reactivity system
(Zustand selectors, TanStack Query hooks, etc.), not to Context re-renders.

---

## §2 — How to structure stores

### Rule: One store per feature, not one store per app

Never create a single monolithic store. Create small, focused stores scoped to a feature.

```tsx
// BAD — one god store
const useStore = create((set) => ({
  user: null,
  cart: [],
  filters: {},
  notifications: [],
  sidebarOpen: false,
}));

// GOOD — separate stores per feature
const useCartStore = create((set) => ({
  items: [],
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
  clear: () => set({ items: [] }),
}));

const useUIStore = create((set) => ({
  sidebarOpen: false,
  activeModal: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openModal: (id: string) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
}));
```

### Rule: Co-locate actions with state

Actions (functions that call `set`) live inside the store, not in components. Components call
`store.addItem(item)`, never `store.setState(...)` directly.

### Rule: Always use selectors

Never destructure the entire store. Select only what the component needs.

```tsx
// BAD — subscribes to entire store, re-renders on any change
const { items, addItem } = useCartStore();

// GOOD — subscribes only to what's needed
const items = useCartStore((s) => s.items);
const addItem = useCartStore((s) => s.addItem);
```

For multiple related values, use `useShallow` to avoid re-renders from new object identity:

```tsx
import { useShallow } from 'zustand/react/shallow';

const { items, total } = useCartStore(
  useShallow((s) => ({ items: s.items, total: s.total }))
);
```

### Rule: Keep store state serializable

Store values should be plain objects, arrays, strings, numbers, booleans, and null.
Never store React elements, class instances, or DOM nodes.

---

## §3 — Zustand + Context (scoped stores)

Use this pattern when you need Zustand's selector performance but the store should be
scoped to a subtree, not global. Common for reusable complex components (data grids,
multi-select groups, form builders).

```tsx
import { createStore, useStore } from 'zustand';
import { createContext, useContext, useRef } from 'react';

// 1. Factory function — not a global store
const createGridStore = (initialState) =>
  createStore((set) => ({
    ...initialState,
    selectRow: (id) => set((s) => ({ selectedIds: [...s.selectedIds, id] })),
  }));

// 2. Context holds the STORE INSTANCE, not the store values
const GridStoreContext = createContext(null);

// 3. Provider creates the store once
function GridProvider({ children, initialState }) {
  const storeRef = useRef(null);
  if (storeRef.current === null) {
    storeRef.current = createGridStore(initialState);
  }
  return (
    <GridStoreContext.Provider value={storeRef.current}>
      {children}
    </GridStoreContext.Provider>
  );
}

// 4. Custom hook with selector
function useGridStore(selector) {
  const store = useContext(GridStoreContext);
  if (!store) throw new Error('useGridStore must be inside <GridProvider>');
  return useStore(store, selector);
}
```

**Use this pattern when:**
- The store needs to be initialized with props
- Multiple instances of the component can coexist (each needs isolated state)
- You're building a reusable library component

**Use a plain global store when:**
- There is truly only one instance (app-wide cart, UI preferences)
- No prop-based initialization is needed

Note: this is exactly what TanStack Query does with `<QueryClientProvider>` and what
Redux does with its `<Provider>`. Context provides the stable store instance;
Zustand's selectors handle the actual subscriptions.

---

## §4 — Middleware usage

### `persist` — Use for state that should survive page reloads
```tsx
import { persist } from 'zustand/middleware';

const useCartStore = create(
  persist(
    (set) => ({ items: [], /* ... */ }),
    { name: 'cart-storage' } // localStorage key
  )
);
```
Only persist state the user would expect to survive a refresh (cart, preferences, draft content).
Never persist derived state or server data.

### `devtools` — Always enable in development
```tsx
import { devtools } from 'zustand/middleware';

const useCartStore = create(
  devtools(
    (set) => ({ /* ... */ }),
    { name: 'CartStore' }
  )
);
```

### Composition: stack middleware inside-out
```tsx
const useStore = create(
  devtools(
    persist(
      (set) => ({ /* ... */ }),
      { name: 'store-key' }
    ),
    { name: 'StoreName' }
  )
);
```

---

## §5 — What NOT to do with Zustand

1. **Never sync props into a store with useEffect.** If you need to initialize from props,
   use the scoped store pattern (§3). If you find yourself writing
   `useEffect(() => { store.setState(props) }, [props])`, you're fighting React's data flow.

2. **Never store server data in Zustand.** Use TanStack Query for fetched data.
   If you need to combine server data with client state, read from both:
   ```tsx
   const { data: products } = useQuery({ queryKey: ['products'] });
   const cartIds = useCartStore((s) => s.itemIds);
   const cartProducts = products?.filter(p => cartIds.includes(p.id));
   ```

3. **Never use Zustand to pass state from a parent to its direct child.** That's what
   props are for. Zustand solves the problem of *distant, unrelated* components sharing state.

4. **Never create a store in a component body without a ref guard.**
   This creates a new store every render. Use `useRef` (see §3).
