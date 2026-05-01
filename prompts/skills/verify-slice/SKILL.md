---
name: verify-slice
description: Run the active Project's build and typecheck heuristic and return a structured verification result.
disable-model-invocation: false
response_schema: verify_result
args:
  type: object
  required:
    - project_root
  properties:
    project_root:
      type: string
      description: Absolute path to the active Project root.
---

Run the active Project's verification checks silently and return a structured result.

## Heuristic

Inspect `<project>/package.json`.

If there is no `package.json`, or if it has no usable `scripts`, verification succeeds:

```json
{ "ok": true, "message": "No build or typecheck script configured." }
```

If `scripts.build` is a string, run:

```bash
bun run build
```

If `scripts.typecheck` is a string, run:

```bash
bun run typecheck
```

Run `build` first, then `typecheck`. Stop at the first failing check.

## Result contract

Return only one JSON object with this exact shape:

```json
{ "ok": true, "message": "Verification passed." }
```

Use `{ "ok": true, "message": "Verification passed." }` only when every configured check exits with code 0.

Use `{ "ok": false, "message": "..." }` when a check cannot run or exits non-zero. Keep the message short and factual. Include the script name and the most useful stderr or stdout excerpt, trimmed to the essential failure.

Do not modify Project files. Do not add tests. Do not call a real LLM.
