---
name: write-brief
description: Generate the user-visible Brief artifact from a structured Scoping summary in the Guide's voice.
disable-model-invocation: false
response_schema: artifact_write
args:
  type: object
  required:
    - project_root
    - summary
  properties:
    project_root:
      type: string
      description: Absolute path to the active Project root.
    summary:
      type: object
      description: What the user wants to build, who it is for, and what done feels like.
    project_name:
      type: string
      description: Optional working name to use if the user has already named the Project.
---

Write `<project>/brief.html` from the provided Scoping summary. This is user-visible artifact work for the Guide: write the file silently, do not chat with the user, and do not mention file paths in the artifact.

## Inputs

Use the structured `summary` as the source of truth. It should describe:

- what the user wants to build
- who the Project is for
- what should feel true when the Project is useful
- constraints, preferences, or examples the user has already given

If a load-bearing dimension is missing, do not write or modify `brief.html`. Return an `artifact_write` result with `outcome: "blocked"`, `path: ""`, and a short message naming the missing input.

## Output path

Write the Brief to:

`<project>/brief.html`

Overwrite any existing file at that path. The file must be a complete HTML document with all CSS inline inside a `<style>` tag. Do not depend on external assets, scripts, fonts, or stylesheets.

## Visual shell

Use the same self-contained slideshow shell the Guide uses today:

- a Kanagawa-inspired palette
- a left-hand index of sections
- a detailed view for the selected section on the right
- responsive behavior that remains readable in a narrow panel
- no lead-in description paragraph below the `Brief` title; go straight from the title to the section index

Use these palette anchors unless the content needs a tiny adjustment for contrast:

- dark ink background: `#1f1f28`
- panel surface: `#2a2a37`
- muted surface: `#363646`
- text: `#dcd7ba`
- muted text: `#c8c093`
- warm Brief accent: `#e6c384`
- red / rose accent for warnings or boundaries: `#c34043`
- blue accent for secondary details: `#7e9cd8`

## Content guidance

Write in the Guide's plain-language voice. The user should feel heard, not managed. Avoid engineering vocabulary unless the user used it first and it matters.

Each section should explain what will be built and why it matters. Include concrete implementation details only when they affect the user's experience, for example a required content source, an important device, or a success behavior.

Good section shapes include:

- the Project at a glance
- who it is for
- what it needs to do first
- what done feels like
- important constraints or nice-to-haves

Keep the Brief specific to the user's Project. Do not produce a generic product template, do not expose hidden reasoning, and do not mention this skill.

After writing the file, return only one JSON object matching `artifact_write`:

```json
{ "outcome": "complete", "message": "Brief written.", "path": "brief.html" }
```
