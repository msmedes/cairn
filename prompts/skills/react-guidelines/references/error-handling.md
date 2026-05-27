# Error Handling & Async State Patterns

## §1 — The loading/error/data rendering order

Every component that consumes async data must handle three states: loading, error, and success.
The rendering order is fixed. Never deviate from this.

### Rule: Render in this order — error → loading → empty → data

```tsx
function InvoiceList() {
  const { data: invoices, isLoading, error } = useInvoices();

  if (error) return <ErrorBanner error={error} />;
  if (isLoading) return <Spinner />;
  if (!invoices?.length) return <EmptyState message="No invoices yet" />;

  return (
    <ul>
      {invoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)}
    </ul>
  );
}
```

**Why this order:**
- Error first: if something went wrong, don't pretend it didn't. Never show stale data
  alongside an error unless you've made a deliberate UX decision to do so.
- Loading second: only show a spinner if there's no error.
- Empty third: distinguish "we loaded successfully and there's nothing" from "we're still loading."
- Data last: the happy path.

### Rule: Use a shared set of status components

Create these once in `src/components/` and use them everywhere:

- `<Spinner />` — loading indicator (can accept a `size` prop)
- `<ErrorBanner error={Error} onRetry?: () => void />` — displays error message, with optional retry button for transient errors
- `<EmptyState message={string} action?: ReactNode />` — "nothing here" with optional CTA

Never inline a `<p>Loading...</p>` or `<p>Something went wrong</p>`. Consistency comes from
using the same components everywhere.

---

## §2 — Error boundaries

Error boundaries catch rendering errors. They do NOT catch errors in event handlers,
async code, or effects (those need try/catch).

### Rule: Place error boundaries at two levels

**Level 1: Route-level boundary** — wraps each page/route. If a page blows up,
the rest of the app (nav, sidebar) survives.

```tsx
// src/app/router.tsx
<Route
  path="/invoices"
  element={
    <RouteErrorBoundary>
      <InvoicesPage />
    </RouteErrorBoundary>
  }
/>
```

**Level 2: Widget-level boundary** — wraps independent sections within a page that
should fail independently. If one dashboard card errors, the others still render.

```tsx
function DashboardPage() {
  return (
    <div className="grid">
      <WidgetErrorBoundary><RevenueChart /></WidgetErrorBoundary>
      <WidgetErrorBoundary><RecentOrders /></WidgetErrorBoundary>
      <WidgetErrorBoundary><ActivityFeed /></WidgetErrorBoundary>
    </div>
  );
}
```

### Rule: Error boundaries show a fallback, not a blank screen

```tsx
function RouteErrorBoundary({ children }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <div className="error-page">
          <h2>Something went wrong</h2>
          <p>{error.message}</p>
          <button onClick={resetErrorBoundary}>Try again</button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
```

Use `react-error-boundary` — don't build your own. It handles reset, fallback rendering,
and `onError` logging.

### Rule: Log errors at the boundary, not in every component

Pass an `onError` callback to the error boundary that sends to your logging service.
Individual components should NOT have try/catch around rendering logic.

---

## §3 — Mutation error handling

### Rule: Pick ONE pattern for showing mutation errors and use it everywhere

The two acceptable patterns:

**Pattern A: Inline error (preferred for forms and targeted actions)**
Show the error next to the thing that failed.

```tsx
function InvoiceEditor({ invoice }) {
  const update = useUpdateInvoice();

  return (
    <form onSubmit={(e) => { e.preventDefault(); update.mutate(formData); }}>
      {update.error && <ErrorBanner error={update.error} />}
      {/* form fields */}
      <button disabled={update.isPending}>
        {update.isPending ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

**Pattern B: Toast (preferred for background actions like delete, archive, bulk ops)**
Show a transient notification. Use a Zustand store for the toast queue.

```tsx
function InvoiceRow({ invoice }) {
  const remove = useDeleteInvoice();
  const showToast = useToastStore((s) => s.show);

  const handleDelete = () => {
    remove.mutate(invoice.id, {
      onError: (err) => showToast({ type: 'error', message: `Delete failed: ${err.message}` }),
      onSuccess: () => showToast({ type: 'success', message: 'Invoice deleted' }),
    });
  };

  return <button onClick={handleDelete}>Delete</button>;
}
```

### Rule: Never silently swallow errors

Every `mutate` call must handle the error case — either via the mutation hook's `error` state
rendered in JSX (Pattern A), or via an `onError` callback (Pattern B). If you can't see the
error anywhere in the component, it's swallowed.

---

## §4 — Handling unexpected states at runtime

Even with perfect TypeScript types, impossible states can occur at runtime: an API returns
a status your code doesn't recognize, localStorage holds a value from an old schema,
a URL param is garbage, or a bug introduces a state your types said was impossible.

### Rule: Distinguish internal state bugs from unexpected external data

These require different responses.

**Internal state bug** — your own discriminated union hits a case that shouldn't exist.
This means your types lied or a code path produced corrupt state. **Throw.**

```tsx
function WizardStep({ state }: { state: WizardState }) {
  switch (state.step) {
    case 'info':     return <InfoStep />;
    case 'payment':  return <PaymentStep />;
    case 'confirm':  return <ConfirmStep />;
    default:         return assertNever(state);
    // Throws at runtime → caught by error boundary → visible, debuggable
  }
}
```

The thrown error is caught by the nearest error boundary (§2). The user sees a recoverable
error page. Your error tracker captures the bug with the unexpected value in the message.
This is correct — the component cannot render anything meaningful because its state is corrupt.

**Unexpected external data** — an API, URL, or storage gives you a value you don't handle.
This is not a bug in your code. **Log and render a fallback.**

```tsx
function StatusBadge({ status }: { status: string }) {
  // status comes from an API — we can't guarantee it matches our known values
  switch (status) {
    case 'draft':   return <Badge color="gray">Draft</Badge>;
    case 'sent':    return <Badge color="blue">Sent</Badge>;
    case 'paid':    return <Badge color="green">Paid</Badge>;
    case 'overdue': return <Badge color="red">Overdue</Badge>;
    default:
      // Log so we know the API sent something new, but don't crash
      reportUnexpectedValue('InvoiceStatus', status);
      return <Badge color="gray">{status}</Badge>;
  }
}
```

### Rule: Use the scope of impact to decide throw vs. fallback

Ask: **"If I throw here, what breaks?"**

- If the switch controls the **entire component's output** (a page, a wizard, a router),
  throwing is correct. There's no meaningful partial render. The error boundary provides
  the fallback.

- If the switch controls a **small piece of UI** (a badge, an icon, a label), crashing the
  whole page over a badge is disproportionate. Log the unexpected value and render something
  reasonable (the raw value, a generic placeholder, or a default variant).

### Rule: Create a `reportUnexpectedValue` utility

```tsx
// src/utils/reportUnexpectedValue.ts
function reportUnexpectedValue(context: string, value: unknown): void {
  const message = `Unexpected value in ${context}: ${JSON.stringify(value)}`;
  console.error(message);
  // Send to your error tracking service (Sentry, DataDog, etc.)
  reportError(new Error(message));
}
```

This ensures unexpected values are always visible in your error tracker, even when
you choose not to throw. Silent `default:` cases with no logging are never acceptable —
they hide problems that will compound over time.

### Rule: Validate external data at the boundary, not in every component

Don't scatter `default: reportUnexpectedValue(...)` across dozens of components.
Instead, validate and transform API responses at the data layer:

```tsx
// src/features/invoices/api.ts
const KNOWN_STATUSES = ['draft', 'sent', 'paid', 'overdue'] as const;
type InvoiceStatus = (typeof KNOWN_STATUSES)[number];

function parseInvoiceStatus(raw: string): InvoiceStatus {
  if (KNOWN_STATUSES.includes(raw as InvoiceStatus)) {
    return raw as InvoiceStatus;
  }
  reportUnexpectedValue('InvoiceStatus', raw);
  return 'draft'; // safe fallback
}

function parseInvoice(raw: unknown): Invoice {
  // ... validate shape ...
  return {
    ...raw,
    status: parseInvoiceStatus(raw.status),
  };
}
```

Now every component downstream receives a validated `InvoiceStatus` and can use
`assertNever` in switches without worrying about unknown values. The boundary
function handles the unexpected case once.

### Summary

| Source of unexpected value | Response | Mechanism |
|---------------------------|----------|-----------|
| Own discriminated union state | Throw | `assertNever` → error boundary catches |
| API response | Log + fallback | Validate at data boundary with `reportUnexpectedValue` |
| URL params / search params | Log + fallback or redirect | Validate in route loader or page component |
| localStorage / persisted state | Log + fallback or reset | Validate on read, clear if corrupt |
| `default` case with no handling | Never acceptable | Always either `assertNever` or `reportUnexpectedValue` |
