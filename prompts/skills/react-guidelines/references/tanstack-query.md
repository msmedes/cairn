# TanStack Query Rules

## §1 — When to use TanStack Query

### Rule: All server data goes through TanStack Query

If data comes from an API, database, or any external server, use TanStack Query.
Do not fetch in useEffect and store in useState. No exceptions.

TanStack Query gives you caching, background refetching, loading/error states, request deduplication,
and stale-while-revalidate — all things you would otherwise build poorly by hand.

### What TanStack Query replaces
- `useEffect` + `fetch` + `useState` for loading + `useState` for error + `useState` for data
- Custom `useFetch` hooks that reinvent caching badly
- Storing API responses in Zustand or Redux
- Manual cache invalidation logic

### What TanStack Query does NOT replace
- Client-only state (UI state, form state) → use `useState` or Zustand
- URL state (pagination, filters in the URL) → use router params, feed them as query keys
- Static configuration → use Context or module-level constants

---

## §2 — Generated API clients (MUST USE)

### Rule: Always use the generated API clients for backend calls

The codebase has auto-generated API client packages produced by `pnpm sync-api` (using
`@hey-api/openapi-ts`). These packages are the **single source of truth** for all backend
communication. Never hand-write `fetch` calls, query keys, query functions, or types for
endpoints that exist in these packages.

### Generated packages

| Package | Import | Backend |
|---------|--------|---------|
| `@keru/agent-framework-api` | `from '@keru/agent-framework-api'` | agent-framework |
| `@keru/crud-service-rest-client` | `from '@keru/crud-service-rest-client'` | crud-service |
| `@keru/crud-service-admin-client` | `from '@keru/crud-service-admin-client'` | crud-service admin |
| `@keru/dataflow-api` | `from '@keru/dataflow-api'` | dataflow |

### What each package provides

Each package generates these artifacts from the backend's OpenAPI spec:

1. **TypeScript types** (`types.gen.ts`) — request, response, and error types for every endpoint,
   plus all domain model types. Use these directly; never redefine them.
2. **SDK functions** (`sdk.gen.ts`) — one typed function per REST endpoint (e.g., `getConversation`,
   `createConversation`). These are the low-level fetch wrappers.
3. **TanStack Query helpers** (`@tanstack/react-query.gen.ts`):
   - **Query key factories**: `getConversationQueryKey(options)` — stable, typed cache keys
   - **Query options factories**: `getConversationOptions(options)` — returns `queryOptions()` ready
     for `useQuery()`
   - **Mutation options factories**: `createConversationMutation(options)` — returns
     `UseMutationOptions` ready for `useMutation()`
4. **Zod schemas** (`zod.gen.ts`) — runtime validation schemas for all types. Use for form
   validation or runtime checks when needed.
5. **HTTP client** (`client.gen.ts`) — preconfigured fetch client with base URL.

### Rule: Use generated query options for all GET endpoints

```tsx
// BAD — hand-writing what the codegen already provides
useQuery({
  queryKey: ['conversations', id],
  queryFn: () => fetch(`/api/agent/v1/conversations/${id}`).then(r => r.json()),
});

// GOOD — use the generated options factory
import { getConversationOptions } from '@keru/agent-framework-api';

const { data, isLoading, error } = useQuery(
  getConversationOptions({ path: { id: conversationId } })
);
```

### Rule: Use generated mutation options for all write endpoints

```tsx
// BAD — hand-written mutation
useMutation({
  mutationFn: (body: CreateConversationInput) =>
    fetch('/api/agent/v1/conversations', { method: 'POST', body: JSON.stringify(body) }),
});

// GOOD — use the generated mutation factory
import { createConversationMutation } from '@keru/agent-framework-api';

const mutation = useMutation({
  ...createConversationMutation(),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: listConversationsQueryKey() });
  },
});
```

### Rule: Use generated query key factories for invalidation

```tsx
import {
  listConversationsQueryKey,
  getConversationQueryKey,
} from '@keru/agent-framework-api';

// Invalidate a specific conversation
queryClient.invalidateQueries({ queryKey: getConversationQueryKey({ path: { id } }) });

// Invalidate conversation lists
queryClient.invalidateQueries({ queryKey: listConversationsQueryKey() });
```

### Rule: Use generated types, never redefine them

```tsx
// BAD — redefining types that already exist in the generated package
interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

// GOOD — import from the generated package
import type { ConversationResponse } from '@keru/agent-framework-api';
```

### Rule: Use Zod schemas from generated packages when you need runtime validation

```tsx
// GOOD — generated Zod schema for form validation
import { zCreateConversationBody } from '@keru/agent-framework-api';

const schema = zCreateConversationBody;
```

### When to wrap generated helpers in a custom hook

Only wrap in a custom hook when you need to add extra behavior beyond what the generated
options provide (e.g., `enabled` logic, `select` transforms, cache invalidation on mutations).
If you're just passing options through, use the generated factory directly in the component.

```tsx
// Wrapper justified — adds conditional enabled logic and data transform
export function useConversation(id: string | undefined) {
  return useQuery({
    ...getConversationOptions({ path: { id: id! } }),
    enabled: !!id,
    select: (data) => ({ ...data, displayTitle: data.title || 'Untitled' }),
  });
}

// No wrapper needed — use directly in component
const { data } = useQuery(listConversationsOptions({ query: { limit: 20 } }));
```

---

## §3 — Manual query patterns (for non-generated endpoints only)

The rules below apply **only** when calling endpoints that are NOT covered by a generated API
client package (e.g., third-party APIs, internal tooling endpoints). For all backend endpoints
served by agent-framework, crud-service, or dataflow, use the generated clients from §2.

### Query key conventions

#### Rule: Query keys are arrays, structured hierarchically

```tsx
// Entity type → specific identifier → sub-resource
['users']                    // all users
['users', userId]            // single user
['users', userId, 'posts']   // user's posts
['products', { category, sort }]  // filtered list
```

#### Rule: Query keys must include every variable the query depends on

If the fetch function uses a variable, that variable must be in the key.
This is non-negotiable — it's how TanStack Query knows when to refetch.

```tsx
// BAD — page is used in fetch but not in key
useQuery({
  queryKey: ['invoices'],
  queryFn: () => fetchInvoices(page, filters),
});

// GOOD — every dependency is in the key
useQuery({
  queryKey: ['invoices', page, filters],
  queryFn: () => fetchInvoices(page, filters),
});
```

#### Rule: Create a query key factory per feature

```tsx
// src/features/invoices/queries.ts
export const invoiceKeys = {
  all:      () => ['invoices'] as const,
  lists:    () => [...invoiceKeys.all(), 'list'] as const,
  list:     (filters: InvoiceFilters) => [...invoiceKeys.lists(), filters] as const,
  details:  () => [...invoiceKeys.all(), 'detail'] as const,
  detail:   (id: string) => [...invoiceKeys.details(), id] as const,
};
```

This makes invalidation precise:
```tsx
// Invalidate all invoice lists (but not individual details)
queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
```

### Query function patterns

#### Rule: Query functions are standalone, not inline

```tsx
// BAD — inline function, hard to test or reuse
useQuery({
  queryKey: ['user', id],
  queryFn: async () => {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error('Failed to fetch user');
    return res.json();
  },
});

// GOOD — separate function
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}

// In component or custom hook:
useQuery({
  queryKey: ['user', id],
  queryFn: () => fetchUser(id),
});
```

#### Rule: Wrap useQuery in a custom hook per query

```tsx
// src/features/users/queries.ts
export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => fetchUser(id),
    enabled: !!id,
  });
}

// In component — clean, readable
function UserProfile({ userId }) {
  const { data: user, isLoading, error } = useUser(userId);
}
```

---

## §4 — Mutations (manual patterns for non-generated endpoints)

### Rule: Use `useMutation` for all write operations

Never call `fetch` with POST/PUT/DELETE directly in an event handler. Use `useMutation`
so you get loading state, error handling, and cache invalidation in one place.

```tsx
export function useUpdateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invoice: UpdateInvoiceInput) => updateInvoice(invoice),
    onSuccess: (data, variables) => {
      // Update the specific item in cache
      queryClient.setQueryData(
        invoiceKeys.detail(variables.id),
        data
      );
      // Invalidate lists so they refetch
      queryClient.invalidateQueries({
        queryKey: invoiceKeys.lists(),
      });
    },
  });
}

// In component
function InvoiceEditor({ invoice }) {
  const updateInvoice = useUpdateInvoice();

  function handleSave(values) {
    updateInvoice.mutate({ id: invoice.id, ...values });
  }

  return (
    <form onSubmit={handleSave}>
      {updateInvoice.isPending && <Spinner />}
      {updateInvoice.error && <ErrorBanner error={updateInvoice.error} />}
      {/* form fields */}
    </form>
  );
}
```

### Rule: Prefer invalidation over manual cache updates

`queryClient.invalidateQueries()` is simpler and less error-prone than manually updating
cache entries. Only use `setQueryData` for optimistic updates where instant UI feedback matters.

---

## §5 — Dependent and conditional queries

### Rule: Use `enabled` for conditional fetching, never `if` guards around hooks

```tsx
// BAD — conditionally calling a hook (breaks rules of hooks)
function UserPosts({ userId }) {
  if (!userId) return null;
  const { data } = useQuery({ queryKey: ['posts', userId], queryFn: ... });
}

// GOOD — always call the hook, use `enabled`
function UserPosts({ userId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['posts', userId],
    queryFn: () => fetchPosts(userId!),
    enabled: !!userId,
  });
  if (!userId) return null;
}
```

### Rule: For dependent queries, key on the upstream data

```tsx
function UserDashboard({ userId }) {
  const { data: user } = useUser(userId);
  const { data: preferences } = useQuery({
    queryKey: ['preferences', user?.preferencesId],
    queryFn: () => fetchPreferences(user!.preferencesId),
    enabled: !!user?.preferencesId,
  });
}
```

---

## §6 — Do NOT do these things

1. **Never store query results in useState or Zustand.**
   TanStack Query IS your state. Read `data` from the hook directly.
   ```tsx
   // BAD
   const { data } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
   const [users, setUsers] = useState([]);
   useEffect(() => { if (data) setUsers(data); }, [data]);

   // GOOD
   const { data: users } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
   ```

2. **Never pass fetched data up to a parent via a callback effect.**
   If the parent needs the data, the parent should call the query hook.
   Query hooks with the same key are deduplicated — there's no wasted request.

3. **Never put query fetching logic in useEffect.**
   If you see `useEffect(() => { fetch(...).then(setData) }, [dep])`, replace it
   with a `useQuery` call with the dependency in the query key.

4. **Never invalidate queries inside useEffect.**
   Invalidation belongs in mutation `onSuccess` callbacks or in event handlers.

---

## §7 — QueryClient configuration

### Rule: Configure the QueryClient once in `src/lib/queryClient.ts`

```tsx
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,  // 1 minute
      retry: 3,
    },
    mutations: {
      onError: (error) => {
        reportError(error);  // global error logging safety net
      },
    },
  },
});
```

This ensures no mutation error goes unlogged, even if a component forgets to handle it.
