---
name: quality-code
description: Use when writing or reviewing TypeScript/full-stack code. Encodes principles for type safety, real tests over mocks, schema-first tool boundaries, observability, and choosing practical abstractions.
---

# Writing Quality Full-Stack TypeScript

Apply these principles when writing or reviewing TypeScript code.

## Make Impossible States Unrepresentable

Use the type system to make invalid states fail at compile time. Fewer reachable states means easier code to read and change.

Prefer discriminated unions over flag bags:

```ts
type State =
  | { status: "loading" }
  | { status: "success"; user: User }
  | { status: "error"; error: string };
```

Brand primitives when two plain strings or numbers are easy to mix up. Validate once at the boundary; downstream code should trust the branded type.

## Let Types Flow End-To-End

Derive types from the source of truth instead of restating shapes by hand. Reach for `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, and `typeof` before creating duplicate interfaces.

For function arguments, pass objects rather than positional primitives unless the path is truly performance-critical.

## Schema-First Boundaries

For tool parameters, artifact data, config files, and runtime-validated inputs:

- Define the runtime shape once as a Zod schema.
- Infer TypeScript types from that schema with `z.infer`.
- Generate tool/runtime JSON Schema from the same Zod schema instead of hand-maintaining TypeBox or raw JSON Schema duplicates.
- Keep hand-written checks for domain behavior that is not just shape validation, such as file existence, unknown task slugs, authorization, or state transitions.
- Do not add unit tests that merely retest Zod required fields, enum values, or min/max lengths. Test persistence, normalization, side effects, routing, and domain failures.

## Tests As Real As Possible

Do not mock things you can run locally. Use real test environments where practical:

- LocalStack for AWS
- Miniflare for Cloudflare Workers
- Real Postgres or SQLite instead of a mock DB

Mock only third-party services that have no test environment.

## Observability

For durable observability, prefer OpenTelemetry spans over ad hoc print logging. Logs are fine for local development, but product debugging should leave a traceable request path.

## Abstractions

Add an abstraction only when it removes real complexity, reduces meaningful duplication, or matches an established project pattern. Keep narrow changes narrow.
