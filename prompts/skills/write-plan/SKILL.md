---
name: write-plan
description: Draft schema-validated Plan artifact content for the agreed first slice in the Guide's voice.
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

This skill is retired for active Plan persistence. Do not draft or write Plan content here. The Guide must persist Plans directly with `create_plan_artifact` or `update_plan_artifact`, because those tools own the schema, envelope, validation, and canonical JSON file.

## Inputs

Use the slice agreement, Brief, and issue files only to decide whether this skill was invoked by mistake. Do not write `plan.json`, `plan.html`, or any replacement file.

Always return an `artifact_write` result with `outcome: "blocked"`, `path: ""`, and a short message telling the Guide to call the Plan artifact tools instead.

## Content shape

When the Guide calls the Plan artifact tools directly, the content should use these fields:

- `title`: short plain-language name for the first slice.
- `summary`: one short paragraph explaining what this slice builds first.
- `from_brief`: one short paragraph paraphrasing what the user wanted and ending with why this first slice fits.
- `outcomes`: concrete, demonstrable capabilities, one sentence each in second person: "You'll be able to..."
- `pieces`: a 3 to 6 item ordered list of small steps. Each step must be something the user could see when it is done, never an engineering task.
- `not_yet`: 2 to 4 things from the Brief that are intentionally not in this first slice, using the user's vocabulary. Avoid phrases like "out of scope" or "deferred features."

Use action-y language: "you'll be able to..." and "I'll work through..." rather than generic product description. Avoid engineering vocabulary throughout.

## Final result

Return only one JSON object matching `artifact_write`:

```json
{ "outcome": "blocked", "message": "Use create_plan_artifact or update_plan_artifact for the Plan.", "path": "" }
```
