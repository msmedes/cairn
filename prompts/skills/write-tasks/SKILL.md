---
name: write-tasks
description: Generate Tasks tab content from issue paths and persist it through the Tasks artifact tool.
disable-model-invocation: false
response_schema: artifact_write
args:
  type: object
  required:
    - project_root
    - issues
  properties:
    project_root:
      type: string
      description: Absolute path to the active Project root.
    issues:
      type: array
      description: Issue file paths and their plain-language descriptions from the Plan's pieces list.
    plan_path:
      type: string
      description: Optional project-relative path to the Plan, normally plan.json.
---

Generate the Tasks tab content from the ordered issue list, then finish by calling the custom Tasks artifact tool. Call `create_tasks_artifact` with one item per issue, using the same plain-language wording as the Plan's pieces.

Do not use raw Write or Edit for Tasks artifact data. Do not create replacement Tasks files. The Tasks artifact tool owns `tasks.json`, derives issue slugs, starts every task as `todo`, and writes the tool-owned envelope metadata.

## Inputs

Use the provided `issues` list as the source of truth. Each item should include an issue file path and the matching plain-language description from the Plan's "The pieces I'll work through" section.

If any issue is missing its path or user-visible title, return `outcome: "blocked"` with one short message naming the missing input. Do not infer hidden engineering task names from filenames when the Plan wording is unavailable.

## Output path

The canonical Tasks path is `<project>/tasks.json`, but you do not write it directly. `create_tasks_artifact` owns initial creation, and `update_task_status` owns routine progress changes after implementation starts.

## Tool sequence

1. Preserve the issue order exactly.
2. Build `issues` entries with `issue_path` and `title`.
3. Call `create_tasks_artifact` with those ordered entries.
4. If the tool returns a validation error and the fix is obvious from the inputs, correct the field and retry once. Otherwise return a small failure result.

After the tool call finishes, return only one JSON object matching `artifact_write`:

```json
{ "outcome": "complete", "message": "Created the Tasks artifact.", "path": "tasks.json" }
```

Use `outcome: "failure"` with `path: ""` when a tool fails and retrying is not safe. Use `outcome: "blocked"` with `path: ""` when the inputs lack issue paths or Plan wording needed for the Tasks tab.

Failure and blocked examples:

```json
{ "outcome": "failure", "message": "create_tasks_artifact failed validation for issues.0.title.", "path": "" }
```

```json
{ "outcome": "blocked", "message": "The Tasks tab needs each issue path and its matching Plan wording.", "path": "" }
```
