# TypeScript Patterns for State Safety

These patterns prevent state-related bugs at compile time. They are not a general TypeScript
style guide — they're specifically about making invalid states unrepresentable.

## §1 — Discriminated unions for state machines

### Rule: Never model async state as independent booleans

Independent booleans allow impossible combinations. `isLoading: true` AND `error: Error`
AND `data: User` can all be true simultaneously — which is meaningless.

```tsx
// BAD — 8 possible combinations, most are impossible/meaningless
type UserState = {
  isLoading: boolean;
  error: Error | null;
  data: User | null;
};

// GOOD — exactly 3 states, all valid
type UserState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: User };
```

Now TypeScript enforces correctness:

```tsx
function UserProfile({ state }: { state: UserState }) {
  switch (state.status) {
    case 'loading':
      return <Spinner />;
    case 'error':
      return <ErrorBanner error={state.error} />;
    case 'success':
      return <Profile user={state.data} />;
  }
}
```

**Note:** TanStack Query already gives you this pattern via its `status` field.
This rule applies to non-query state that you manage yourself — multi-step forms,
connection states, wizard flows, etc.

### Rule: Use discriminated unions for any state with 3+ mutually exclusive modes

```tsx
// Modal states
type ModalState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; itemId: string }
  | { mode: 'confirm-delete'; itemId: string; itemName: string };

// Payment flow
type PaymentState =
  | { step: 'selecting-method' }
  | { step: 'entering-details'; method: PaymentMethod }
  | { step: 'processing'; transactionId: string }
  | { step: 'complete'; receipt: Receipt }
  | { step: 'failed'; error: Error; canRetry: boolean };
```

The discriminant field (`status`, `mode`, `step`) must be a string literal union, not a
generic string. This is what makes exhaustive `switch` statements work.

### Rule: Use string literal unions, not TypeScript enums

Enums emit runtime JavaScript and have surprising edge-case behaviors. String literal unions
are zero-cost types with the same safety. If you need runtime iteration, pair with an
`as const` array:

```tsx
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue'] as const satisfies readonly InvoiceStatus[];
```

---

## §2 — Exhaustive checking with assertNever

### Rule: Every switch on a discriminated union must have a default case using `assertNever`

```tsx
// Define once in src/utils/assertNever.ts
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}
```

If your switch handles all cases, the default branch is unreachable and TypeScript is happy.
If someone adds a new variant and forgets to handle it, the compiler errors.

```tsx
function StatusBadge({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case 'draft':   return <Badge color="gray">Draft</Badge>;
    case 'sent':    return <Badge color="blue">Sent</Badge>;
    case 'paid':    return <Badge color="green">Paid</Badge>;
    case 'overdue': return <Badge color="red">Overdue</Badge>;
    default:        return assertNever(status);
  }
}
```

If `assertNever` executes at runtime, your types lied — it's a genuine bug. The thrown error
is caught by the nearest error boundary. See `error-handling.md §4` for the full runtime
strategy for unexpected states (internal bugs vs. unexpected external data).

---

## §3 — Component prop types

### Rule: Define props as a `type`, not an `interface`

Interfaces can be accidentally extended via declaration merging from other files.
Props should be a closed, explicit contract.

```tsx
type InvoiceRowProps = {
  invoice: Invoice;
  onSelected: (id: string) => void;
  isActive: boolean;
};
```

### Rule: Callback prop types describe the event, not the React implementation

```tsx
// BAD — leaks that the child uses an <input>
type Props = { onChange: (e: React.ChangeEvent<HTMLInputElement>) => void };

// GOOD — domain value, implementation-independent
type Props = { onAmountChanged: (amount: number) => void };
```

The component translates the React event internally. If the implementation changes
(input → slider), the prop type stays the same.

### Rule: Use `null` for intentional absence, `undefined` for optional/unset

```tsx
type UserState =
  | { status: 'loaded'; user: User }
  | { status: 'not-found'; user: null };  // null = we looked, nothing there

type InvoiceFormProps = {
  initialTitle?: string;  // undefined = prop not provided, use default
};
```
