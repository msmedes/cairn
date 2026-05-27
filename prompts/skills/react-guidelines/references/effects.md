# useEffect Rules

## §1 — The default is NO useEffect

useEffect is an escape hatch for synchronizing React with external systems.
If no external system is involved, you almost certainly do not need useEffect.

**External systems:** browser APIs (DOM, IntersectionObserver, ResizeObserver),
third-party non-React widgets (maps, video players, D3), WebSocket connections,
event sources, timers used for real-time features, browser storage listeners.

**NOT external systems:** your own state, your own props, data from your API (use TanStack Query),
derived values, event responses.

---

## §2 — Banned useEffect patterns (never do these)

### Pattern 2a: Deriving state from other state

```tsx
// ❌ BANNED
const [firstName, setFirstName] = useState('');
const [lastName, setLastName] = useState('');
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);

// ✅ CORRECT — compute during render
const fullName = `${firstName} ${lastName}`;
```

If the computation is expensive (and you've confirmed this by profiling), use `useMemo`:
```tsx
const filtered = useMemo(
  () => items.filter(item => item.category === activeCategory),
  [items, activeCategory]
);
```

### Pattern 2b: Resetting state when a prop changes

```tsx
// ❌ BANNED
function UserProfile({ userId }) {
  const [comment, setComment] = useState('');
  useEffect(() => {
    setComment('');
  }, [userId]);
}

// ✅ CORRECT — use a key to remount the component
<UserProfile key={userId} userId={userId} />
```

When React sees a different `key`, it destroys and recreates the component,
which resets all state automatically with zero useEffect.

### Pattern 2c: Notifying parent of state changes

```tsx
// ❌ BANNED
function Child({ onTextChanged }) {
  const [text, setText] = useState('');
  useEffect(() => {
    onTextChanged(text);
  }, [text, onTextChanged]);
}

// ✅ CORRECT — call the callback in the event handler
function Child({ onTextChanged }) {
  const [text, setText] = useState('');
  function handleChange(e) {
    const newText = e.target.value;
    setText(newText);
    onTextChanged(newText);
  }
  return <input value={text} onChange={handleChange} />;
}

// ✅ EVEN BETTER — lift the state. Parent owns text, child is controlled.
function Child({ text, onTextChanged }) {
  return <input value={text} onChange={(e) => onTextChanged(e.target.value)} />;
}
```

### Pattern 2e: Chaining effects (one effect sets state that triggers another)

```tsx
// ❌ BANNED
useEffect(() => { setCard(null); }, [round]);
useEffect(() => { setGoldCard(card === bestCard); }, [card]);
useEffect(() => { if (goldCard) setRound(r => r + 1); }, [goldCard]);

// ✅ CORRECT — do all the logic in the event handler
function handlePlayCard(nextCard) {
  const isGold = nextCard === bestCard;
  if (isGold) {
    setRound(r => r + 1);
    setCard(null);
  } else {
    setCard(nextCard);
  }
  setGoldCard(isGold);
}
```

When you chain effects, you cause multiple unnecessary render passes and create
temporal coupling that is extremely hard to debug.

### Pattern 2f: Initializing global/app-wide logic

```tsx
// ❌ BANNED — runs twice in dev mode
function App() {
  useEffect(() => {
    initAnalytics();
    checkAuthToken();
  }, []);
}

// ✅ CORRECT — use module-level initialization
let initialized = false;
function App() {
  if (!initialized) {
    initialized = true;
    initAnalytics();
    checkAuthToken();
  }
  // ...
}

// ✅ ALSO CORRECT — run at module load
initAnalytics();
checkAuthToken();

function App() { /* ... */ }
```

### Pattern 2g: Buying/submitting/mutating in response to a user action

```tsx
// ❌ BANNED
const [submitted, setSubmitted] = useState(false);
useEffect(() => {
  if (submitted) {
    postOrder(cart);
  }
}, [submitted]);

// ✅ CORRECT — call it in the event handler
function handleSubmit() {
  postOrder(cart);
}
```

The rule: if the logic is caused by a user interaction, put it in the event handler.
If the logic is caused by the component appearing on screen, it might be an effect
(but probably use TanStack Query instead).

---

## §3 — Legitimate useEffect use cases

These are the situations where useEffect is the correct tool.

### Use case 1: Synchronizing with a non-React widget

```tsx
useEffect(() => {
  const map = new MapWidget(containerRef.current, { center, zoom });
  return () => map.destroy();
}, [center, zoom]);
```

### Use case 2: Managing event listeners on window/document/external elements

```tsx
useEffect(() => {
  function handleResize() { setWidth(window.innerWidth); }
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

Consider extracting this into a custom hook (`useWindowSize`, `useMediaQuery`).

### Use case 3: WebSocket / EventSource connections

```tsx
useEffect(() => {
  const ws = new WebSocket(url);
  ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
  return () => ws.close();
}, [url]);
```

### Use case 4: Focusing an element on mount

```tsx
useEffect(() => {
  inputRef.current?.focus();
}, []);
```

Note: prefer `autoFocus` attribute when possible.

### Use case 5: Intersection/Resize/Mutation observers

```tsx
useEffect(() => {
  const observer = new IntersectionObserver(callback, options);
  if (elementRef.current) observer.observe(elementRef.current);
  return () => observer.disconnect();
}, []);
```

### Use case 6: Analytics tracking on page/component view

```tsx
useEffect(() => {
  trackPageView(pageId);
}, [pageId]);
```

This is legitimate because it's caused by the component appearing on screen,
not by a user interaction.

---

## §4 — The one hygiene rule

### Rule: Every legitimate effect must have a cleanup function

If the effect creates a subscription, connection, listener, or observer, the cleanup
function must tear it down. The only exception is fire-and-forget analytics tracking.

For extraction of effects into custom hooks, see `hooks.md §1`.
