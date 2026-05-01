---
name: write-plan
description: Generate the user-visible Plan artifact for the agreed first slice in the Guide's voice.
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
      description: Project-relative path to the Brief, normally brief.html.
    issues_directory:
      type: string
      description: Project-relative path to the issue files directory, normally issues/.
---

Write `<project>/plan.html` for the agreed slice. This is user-visible artifact work for the Guide: write the file silently, do not chat with the user, and do not show PRD or issue content unless the user explicitly asked elsewhere.

## Inputs

Use the slice agreement as the main source of truth. Read the Brief when a `brief_path` is provided so the slice clearly connects back to the whole Project. Read the issue files in `issues_directory` when provided so the Plan's "pieces I'll work through" section matches the plain-language implementation pieces.

If the slice cannot be named in user-visible terms, or if the issue list is too vague to produce plain-language pieces, do not write or modify `plan.html`. Return an `artifact_write` result with `outcome: "blocked"`, `path: ""`, and a short message naming the missing input.

## Output path

Write the Plan to:

`<project>/plan.html`

Overwrite any existing file at that path. The file must be a complete HTML document with all CSS inline inside a `<style>` tag. Do not depend on external assets, scripts, fonts, or stylesheets.

## Visual shell

Use the same Kanagawa-inspired slideshow shell as the Brief:

- a left-hand index of sections
- a detailed view for the selected section on the right
- responsive behavior that remains readable in a narrow panel
- no lead-in description paragraph below the `Plan` title; go straight from the title to the section index

Make the Plan visually distinct from the Brief. Use the green accent `#98bb6c` for headings, selected index states, and key highlights. Keep the base palette aligned with the Brief:

- dark ink background: `#1f1f28`
- panel surface: `#2a2a37`
- muted surface: `#363646`
- text: `#dcd7ba`
- muted text: `#c8c093`
- green Plan accent: `#98bb6c`
- blue secondary accent: `#7e9cd8`

## Required structure

Write exactly four sections, in this order:

1. `From your brief` - one short paragraph paraphrasing what the user said they wanted, ending with which piece the Guide is starting with so the slice-to-whole connection is visible.
2. `What you'll have when this is done` - concrete, demonstrable capabilities, one sentence each in second person: "You'll be able to..."
3. `The pieces I'll work through` - a numbered list of 3 to 6 small steps. Each step must be something the user could see when it is done, never an engineering task.
4. `Not yet` - 2 to 4 things from the Brief that are intentionally not in this first slice, using the user's vocabulary. Avoid phrases like "out of scope" or "deferred features."

Use action-y language: "you'll be able to..." and "I'll work through..." rather than generic product description. Avoid engineering vocabulary throughout.

After writing the file, return only one JSON object matching `artifact_write`:

```json
{ "outcome": "complete", "message": "Plan written.", "path": "plan.html" }
```
