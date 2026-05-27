# Composition Patterns

## §1 — When to use composition

Composition means restructuring your component tree so that parents render children directly,
eliminating prop tunneling without introducing Context or stores.

### Rule: Use composition BEFORE Context or Zustand for prop tunneling

If a prop is passed through an intermediate component that doesn't use it, restructure
the tree before adding a store or context.

```tsx
// PROBLEM — Layout tunnels `user` to Avatar without using it
function Page({ user }) {
  return <Layout user={user} />;
}
function Layout({ user }) {        // ← doesn't use user, just passes it
  return <Header user={user} />;
}
function Header({ user }) {
  return <Avatar user={user} />;
}

// SOLUTION — compose children so Page renders Avatar directly
function Page({ user }) {
  return (
    <Layout header={<Header avatar={<Avatar user={user} />} />}>
      <MainContent />
    </Layout>
  );
}
function Layout({ header, children }) {
  return (
    <div className="layout">
      <div className="layout-header">{header}</div>
      <div className="layout-body">{children}</div>
    </div>
  );
}
function Header({ avatar }) {
  return <nav>{avatar}</nav>;
}
```

Now `Layout` and `Header` know nothing about `user`. They are fully reusable.

---

## §2 — The `children` prop

### Rule: Use `children` for the primary content slot

```tsx
// GOOD — Card doesn't know what's inside it
function Card({ children }) {
  return <div className="card">{children}</div>;
}

<Card>
  <h2>{title}</h2>
  <p>{description}</p>
</Card>
```

### Rule: Use named props for secondary slots

When a component has multiple insertion points, use `children` for the main content
and named props for other slots.

```tsx
function Dialog({ title, footer, children }) {
  return (
    <div className="dialog">
      <div className="dialog-header">{title}</div>
      <div className="dialog-body">{children}</div>
      <div className="dialog-footer">{footer}</div>
    </div>
  );
}

<Dialog
  title={<h2>Confirm deletion</h2>}
  footer={<Button onClick={onConfirm}>Delete</Button>}
>
  <p>This action cannot be undone.</p>
</Dialog>
```

---

## §3 — Compound components

Use compound components when multiple sub-components need to share implicit state
managed by a parent, and you want consumers to compose them flexibly.

### When to use compound components
- The parent owns a single piece of coordinating state (active tab, open item, selected value)
- Consumers should choose which sub-components to include and in what order
- You're building a design system or reusable component library
- Examples: Tabs, Accordion, Select, Menu, Toolbar

### How to implement

```tsx
// 1. Create a context for the shared state
const TabsContext = createContext<{
  activeId: string;
  setActiveId: (id: string) => void;
} | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab components must be inside <Tabs>');
  return ctx;
}

// 2. Parent component owns the state
function Tabs({ defaultValue, children }) {
  const [activeId, setActiveId] = useState(defaultValue);
  return (
    <TabsContext.Provider value={{ activeId, setActiveId }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

// 3. Sub-components read from context
function TabList({ children }) {
  return <div role="tablist">{children}</div>;
}

function Tab({ id, children }) {
  const { activeId, setActiveId } = useTabsContext();
  return (
    <button
      role="tab"
      aria-selected={activeId === id}
      onClick={() => setActiveId(id)}
    >
      {children}
    </button>
  );
}

function TabPanel({ id, children }) {
  const { activeId } = useTabsContext();
  if (activeId !== id) return null;
  return <div role="tabpanel">{children}</div>;
}

// 4. Attach sub-components to parent for clean API
Tabs.List = TabList;
Tabs.Tab = Tab;
Tabs.Panel = TabPanel;

// 5. Consumer usage
<Tabs defaultValue="billing">
  <Tabs.List>
    <Tabs.Tab id="general">General</Tabs.Tab>
    <Tabs.Tab id="billing">Billing</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel id="general"><GeneralSettings /></Tabs.Panel>
  <Tabs.Panel id="billing"><BillingSettings /></Tabs.Panel>
</Tabs>
```

### Rules for compound components:
- The parent component ALWAYS owns the coordinating state
- Sub-components access state via context, never via cloneElement or Children.map
- Sub-components must throw a helpful error if used outside the parent
- The parent exports sub-components as static properties (`Tabs.Tab`, not a separate `Tab`)


