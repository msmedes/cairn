---
name: write-brief
description: Deprecated Brief writer; the Guide should use create_brief_artifact for schema-validated Brief data.
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

Do not write a Brief file. Brief creation now happens through the Guide's `create_brief_artifact` tool so the Project tab receives schema-validated `brief.json` data with a tool-owned envelope.

## Inputs

Use the structured `summary` as the source of truth. It should describe:

- what the user wants to build
- who the Project is for
- what should feel true when the Project is useful
- constraints, preferences, or examples the user has already given

If invoked, do not write or modify `brief.html`, `brief.md`, or `brief.json`. Return an `artifact_write` result with `outcome: "blocked"`, `path: ""`, and a short message telling the Guide to call `create_brief_artifact` with the structured Brief fields.

## Output path

None. The canonical Brief path is `<project>/brief.json`, and it is owned by the `create_brief_artifact` and `update_brief_artifact` tools.

## Visual shell

The app owns Brief presentation. Do not generate HTML, CSS, scripts, or visual markup.

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

Return only one JSON object matching `artifact_write`:

```json
{ "outcome": "blocked", "message": "Use create_brief_artifact for the Brief.", "path": "" }
```
