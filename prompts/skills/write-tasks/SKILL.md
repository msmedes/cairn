---
name: write-tasks
description: Generate the user-visible Tasks tab checklist from the current slice issue list.
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
      description: Optional project-relative path to the Plan, normally plan.html.
---

Write `<project>/tasks.html` as the initial Tasks tab for Implementing. This is user-visible artifact work for the Guide: write the file silently and do not chat with the user.

## Inputs

Use the provided `issues` list. Each item should include an issue file path and the matching plain-language description from the Plan's "The pieces I'll work through" section.

If the list is missing, empty, or cannot be converted into plain-language user-visible entries, do not write or modify `tasks.html`. Return an `artifact_write` result with `outcome: "blocked"`, `path: ""`, and a short message naming the missing input.

## Output path

Write the Tasks tab to:

`<project>/tasks.html`

Overwrite any existing file at that path. The file must be a complete HTML document with all CSS inline inside a `<style>` tag. Do not depend on external assets, scripts, fonts, or stylesheets.

## Visual treatment

Use the same Kanagawa-inspired base palette as the Brief and Plan, but make this a single-view checklist rather than a slideshow:

- no left-hand section index
- one clear title: `Tasks`
- one checklist with one item per issue, in the same order as the Plan's pieces
- every item starts unchecked
- each item uses the plain-language description, not the issue slug or an engineering task
- keep the issue path in a machine-readable attribute such as `data-issue-path`, not visible text

Use violet `#957fb8` as the concrete accent so the Tasks tab is distinct from the Brief's amber and the Plan's green. Keep the base palette aligned:

- dark ink background: `#1f1f28`
- panel surface: `#2a2a37`
- muted surface: `#363646`
- text: `#dcd7ba`
- muted text: `#c8c093`
- violet Tasks accent: `#957fb8`
- green done accent: `#98bb6c`

Represent each task with stable checkbox semantics that `tick_task` can update later. Prefer list items with an unchecked class and a checkbox marker, for example:

```html
<li class="task unchecked" data-issue-path="issues/01-first-piece.md">
  <span class="box" aria-hidden="true"></span>
  <span class="task-text">The page opens to today's date.</span>
</li>
```

Do not include hidden reasoning, raw PRD text, or issue implementation details.

After writing the file, return only one JSON object matching `artifact_write`:

```json
{ "outcome": "complete", "message": "Tasks written.", "path": "tasks.html" }
```
