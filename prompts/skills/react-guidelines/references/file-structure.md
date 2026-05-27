# File & Folder Structure

## §1 — File placement rules

For every new component or file, answer these questions in order:

```
Is this component used by 2+ features?
├── YES → src/components/{ComponentName}.tsx
│
└── NO → Is this a top-level page/route?
    ├── YES → src/pages/{PageName}/{PageName}.tsx
    │
    └── NO → It belongs to a feature
            → src/features/{feature-name}/
              ├── components/
              │   ├── {FeatureComponent}.tsx     (used outside this feature)
              │   └── internal/
              │       └── {InternalComponent}.tsx (used ONLY within this feature)
              ├── hooks/
              │   └── use{Feature}.ts
              ├── queries.ts          (TanStack Query hooks + key factories)
              ├── api.ts              (raw fetch functions)
              ├── store.ts            (Zustand store, if needed)
              └── types.ts            (feature-specific types)
```

---

## §2 — No barrel files (index.ts)

**Do not use index.ts barrel files for re-exporting.**

Barrel files cause real, documented problems:
- **Broken tree-shaking**: Webpack and many bundlers pull in everything re-exported through
  a barrel, even if only one export is used. This has caused 10x+ bundle size regressions
  in real Next.js and webpack projects.
- **Slower dev server**: Every import through a barrel forces the bundler to resolve the
  entire re-export chain, slowing hot module replacement.
- **Tab confusion**: Multiple files named `index.ts` are indistinguishable in editor tabs.
- **Circular dependency risk**: Barrel files create dependency cycles more easily because
  everything in a folder becomes transitively connected.
- **Navigation friction**: "Go to definition" lands on the barrel, not the actual code.

### What to do instead: use direct imports

```tsx
// GOOD — direct import, clear origin
import { InvoiceTable } from '@/features/invoices/components/InvoiceTable';
import { useInvoices } from '@/features/invoices/queries';
import { useCartStore } from '@/features/cart/store';

// BAD — barrel file, unclear what's inside, breaks tree-shaking
import { InvoiceTable, useInvoices } from '@/features/invoices';
```

Configure path aliases in `tsconfig.json` to keep direct imports readable:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### The one exception: shared component libraries

If you publish an internal component library as an npm package, a single entry point
is necessary. In that case, use the package's `exports` field in `package.json` to
provide per-component entry points so bundlers can tree-shake properly:

```json
{
  "exports": {
    "./Button": "./dist/Button.js",
    "./Modal": "./dist/Modal.js"
  }
}
```

---

## §3 — Internal components

### Rule: Internal components go in `internal/` and are never imported outside their feature

If a component is only used by one other component or within one feature, it lives in
`internal/`. This is a hard boundary — nothing outside the feature folder imports from `internal/`.

```
features/invoices/components/
├── InvoiceTable.tsx            ← used by pages/InvoicesPage
├── InvoiceFilters.tsx          ← used by pages/InvoicesPage
└── internal/
    ├── InvoiceRow.tsx          ← only used by InvoiceTable
    ├── InvoiceStatusBadge.tsx  ← only used by InvoiceRow
    └── FilterChip.tsx          ← only used by InvoiceFilters
```

**During refactoring:** search for imports. If a component in `internal/` is imported
from outside the feature, move it up to `components/` or to `src/components/`.

---

## §4 — File naming rules

### Rule: One component per file

Every React component gets its own file. No file exports more than one component.
Exception: compound component sub-parts can be in the same file as their parent
if they're small (<30 lines each).

### Rule: Files are named after what they export

- Component files: `PascalCase.tsx` — `InvoiceRow.tsx` exports `InvoiceRow`
- Hook files: `camelCase.ts` — `useInvoices.ts` exports `useInvoices`
  (or in `queries.ts` / `store.ts` which can export multiple related hooks)
- Utility files: `camelCase.ts` — `formatCurrency.ts` exports `formatCurrency`
- Type files: `types.ts`
- Store files: `store.ts`
- Query files: `queries.ts`
- API files: `api.ts`

### Rule: Co-locate tests next to source

```
InvoiceTable.tsx
InvoiceTable.test.tsx     ← right next to the component
```

Not in a separate `__tests__/` directory. Tests live next to the code they test.

---

## §5 — The complete project structure

```
src/
├── app/                    ← App shell, providers, router setup
│   ├── App.tsx
│   ├── providers.tsx       ← QueryClientProvider, ThemeProvider, etc.
│   └── router.tsx
│
├── components/             ← Shared generic components (used by 2+ features)
│   ├── Button.tsx
│   ├── Modal.tsx
│   ├── Spinner.tsx
│   └── DataTable.tsx
│
├── features/               ← Domain features (bulk of the app)
│   ├── invoices/
│   │   ├── components/
│   │   │   ├── InvoiceTable.tsx
│   │   │   └── internal/
│   │   │       └── InvoiceRow.tsx
│   │   ├── hooks/
│   │   │   └── useInvoiceForm.ts
│   │   ├── queries.ts
│   │   ├── api.ts
│   │   ├── store.ts
│   │   └── types.ts
│   ├── auth/
│   └── settings/
│
├── hooks/                  ← Shared generic hooks (useMediaQuery, useDebounce)
│   ├── useMediaQuery.ts
│   └── useDebounce.ts
│
├── pages/                  ← Route-level components (thin, compose features)
│   ├── InvoicesPage/
│   │   └── InvoicesPage.tsx
│   └── DashboardPage/
│       └── DashboardPage.tsx
│
├── lib/                    ← Third-party wrappers, configured clients
│   ├── apiClient.ts        ← configured fetch/axios instance
│   └── queryClient.ts      ← TanStack QueryClient setup
│
├── utils/                  ← Pure utility functions (formatDate, cn, etc.)
│   └── format.ts
│
└── types/                  ← App-wide shared types
    └── common.ts
```

---

## §6 — Refactoring: where does this file go?

When reviewing existing code, apply these tests:

1. **Is it imported by 0 files?** → Delete it (dead code).
2. **Is it imported by 1 file in the same feature?** → Move to `internal/`.
3. **Is it imported by multiple files in the same feature?** → Keep in `components/` within the feature.
4. **Is it imported by files in 2+ features?** → Move to `src/components/` (if generic) or reconsider the feature boundary.
5. **Is it a hook used only by one feature?** → Keep in `features/{name}/hooks/`.
6. **Is it a hook used by 2+ features?** → Move to `src/hooks/`.

Check this after every major feature addition:
```bash
# Find components only imported once — candidates for internal/
grep -rn "from.*ComponentName" src/ | wc -l
```
