---
name: write-tasks
description: Deprecated Tasks HTML writer. Tell the Guide to use create_tasks_artifact instead.
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

Do not write a Tasks file. Tasks creation now happens through the Guide's `create_tasks_artifact` tool so the Tasks tab receives schema-validated `tasks.json` data with tool-owned envelope metadata and issue-derived slugs.

## Inputs

Use the provided `issues` list only to determine whether this skill was invoked by mistake. Each item should include an issue file path and the matching plain-language description from the Plan's "The pieces I'll work through" section.

If invoked, do not write or modify `tasks.html`, `tasks.md`, or `tasks.json`. Return an `artifact_write` result with `outcome: "blocked"`, `path: ""`, and a short message telling the Guide to call `create_tasks_artifact` with the ordered issue paths and task titles.

## Output path

None. The canonical Tasks path is `<project>/tasks.json`, and it is owned by `create_tasks_artifact` and `update_task_status`.

Return only one JSON object matching `artifact_write`:

```json
{ "outcome": "blocked", "message": "Call create_tasks_artifact with the ordered issue paths and task titles.", "path": "" }
```
