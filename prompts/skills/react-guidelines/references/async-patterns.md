# Async Event Handler Patterns

Our effects rules say "put async logic in the event handler." This file covers how to do
that correctly — preventing double-submission, race conditions, and stale-closure bugs.

## §1 — Preventing double-submission

### Rule: Disable the trigger using the mutation's `isPending` state

This is the only correct approach. Never use refs, flags, or debounce for this.

```tsx
function InvoiceEditor({ invoice }) {
  const update = useUpdateInvoice();

  const handleSave = (formData: InvoiceFormData) => {
    update.mutate({ id: invoice.id, ...formData });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(getFormData()); }}>
      {/* form fields */}
      <button type="submit" disabled={update.isPending}>
        {update.isPending ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

**Why `isPending` and not a `useState` flag:**
- TanStack Query's `isPending` is automatically true from `mutate()` call to resolution.
  You can't forget to reset it. A manual `useState` flag requires you to set it in the
  handler, clear it in `onSuccess`, clear it in `onError`, AND clear it in `onSettled`.
  Miss one path and the button stays disabled forever (or re-enables too early).
- `isPending` is also available on the mutation result in the cache, so other components
  can react to it (e.g., showing a global saving indicator).

### Rule: For non-mutation async actions, use a loading state from the hook

If the async work isn't a TanStack Query mutation (rare, but possible — e.g., file upload
to a third-party SDK), create a custom hook that returns its own `isPending`:

```tsx
function useFileUpload() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upload = async (file: File) => {
    setIsPending(true);
    setError(null);
    try {
      const url = await uploadToS3(file);
      return url;
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Upload failed'));
      return null;
    } finally {
      setIsPending(false);
    }
  };

  return { upload, isPending, error };
}
```

Note: `finally` guarantees the flag is always reset, regardless of success or failure.

---

## §2 — Optimistic updates

Optimistic updates make the UI feel instant by updating the cache before the server confirms.
They add complexity — only use them when perceived latency is a real UX problem.

### Rule: Only use optimistic updates for actions where latency is noticeable AND the success rate is >99%

Good candidates: toggling a like, reordering a list, marking a notification as read.
Bad candidates: creating a new entity, deleting something, complex form submissions
(these can fail for many reasons).

### Rule: Use the TanStack Query onMutate/onError/onSettled pattern

```tsx
function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => toggleFavoriteAPI(itemId),

    onMutate: async (itemId) => {
      // 1. Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['items'] });

      // 2. Snapshot the previous value for rollback
      const previous = queryClient.getQueryData(['items']);

      // 3. Optimistically update the cache
      queryClient.setQueryData(['items'], (old: Item[]) =>
        old.map(item =>
          item.id === itemId
            ? { ...item, isFavorite: !item.isFavorite }
            : item
        )
      );

      // 4. Return snapshot for rollback
      return { previous };
    },

    onError: (_err, _itemId, context) => {
      // 5. Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['items'], context.previous);
      }
    },

    onSettled: () => {
      // 6. Always refetch to ensure server truth
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}
```

### Rule: Always invalidate in onSettled, even with optimistic updates

The optimistic update is a guess. `onSettled` fires after both success and failure,
ensuring the cache eventually reflects the server's actual state.

---

## §3 — Event handler async patterns summary

| Scenario | Pattern | Don't do |
|----------|---------|----------|
| Form submission | `useMutation` + `isPending` to disable button | `useState` flag + `fetch` in handler |
| Deleting an item | `useMutation` + `onSuccess` toast + `onError` toast | `fetch` + manual state updates |
| Search-as-you-type | `useQuery` with debounced query key | `useEffect` + `fetch` + abort controller |
| Toggle (like/fav) | `useMutation` + optimistic update (§2) | Direct `fetch` + manual cache manipulation |
| File upload (3rd party SDK) | Custom hook with `isPending` state (§1) | Bare async call in event handler |
| Multi-step wizard | Discriminated union state (see `typescript-patterns.md §1`) | Chain of `useEffect` |
