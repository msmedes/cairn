---
name: write-plan
description: Generate Plan artifact content for the agreed first slice and persist it through Plan tools.
disable-model-invocation: false
response_schema: artifact_write
args:
  type: object
  required:
    - project_root
    - slice_agreement
  properties:
    project_root:
      type: string
      description: Absolute path to the active Project root.
    slice_agreement:
      type: string
      description: The slice the Guide proposed and the user agreed to.
    brief_path:
      type: string
      description: Project-relative path to the Brief, normally brief.json.
    issues_directory:
      type: string
      description: Project-relative path to the issue files directory, normally issues/.
---

Generate the Plan content in the Guide's plain-language voice, then finish by calling the custom Plan artifact tool. Call `create_plan_artifact` for a new Plan. Call `update_plan_artifact` only when the inputs clearly say this is a revision of an existing Plan and provide a short reason.

Do not use raw Write or Edit on `plan.html`, `plan.md`, or `plan.json`. Do not create replacement Plan files. The Plan artifact tools own `plan.json`, its schema validation, and its envelope metadata.

## Inputs

Use the slice agreement, Brief, and issue files to write the user-visible Plan. Read referenced files when present, but keep the final Plan plain-language and free of engineering vocabulary. If the slice agreement is too vague to name a concrete first slice, return `outcome: "blocked"` with one short message naming the missing decision.

## Content shape

The Plan artifact tool input uses these fields:

- `title`: short plain-language name for the first slice.
- `summary`: one short paragraph explaining what this slice builds first.
- `from_brief`: one short paragraph paraphrasing what the user wanted and ending with why this first slice fits.
- `outcomes`: concrete, demonstrable capabilities, one sentence each in second person: "You'll be able to..."
- `pieces`: a 3 to 6 item ordered list of small steps. Each step must be something the user could see when it is done, never an engineering task.
- `not_yet`: 2 to 4 things from the Brief that are intentionally not in this first slice, using the user's vocabulary. Avoid phrases like "out of scope" or "deferred features."

Use action-y language: "you'll be able to..." and "I'll work through..." rather than generic product description. Avoid engineering vocabulary throughout.

## Tool sequence

1. Build the complete Plan fields listed above.
2. Call `create_plan_artifact` with the complete Plan content.
3. If the tool reports that `plan.json` already exists and the inputs include a revision reason, call `update_plan_artifact` with the complete replacement Plan content and that reason. If there is no revision reason, return a small failure result instead of guessing.
4. If a tool returns a validation error and the fix is obvious from the inputs, correct the field and retry once. Otherwise return a small failure result.

After the tool call finishes, return only one JSON object matching `artifact_write`:


```json
{ "outcome": "complete", "message": "Created the Plan artifact.", "path": "plan.json" }
```

Use `outcome: "failure"` with `path: ""` when a tool fails and retrying is not safe. Use `outcome: "blocked"` with `path: ""` when the inputs lack a user decision needed for the Plan.

Failure and blocked examples:

```json
{ "outcome": "failure", "message": "create_plan_artifact failed validation for outcomes.", "path": "" }
```

```json
{ "outcome": "blocked", "message": "The first slice needs a concrete user-visible outcome before I can save the Plan.", "path": "" }
```
