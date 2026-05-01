---
name: write-brief
description: Generate Brief artifact content and persist it through the Brief and Project context tools.
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

Generate the Brief content in the Guide's plain-language voice, then finish by calling the custom artifact and context tools. Call `create_brief_artifact` for the user-visible Brief data and call `update_project_context` for durable Project facts the Guide and future Sub-agents should remember.

Do not use raw Write or Edit on `brief.html`, `brief.md`, `brief.json`, or `CONTEXT.md`. Do not create replacement files for the Brief or Project context. The Brief artifact tool owns `brief.json`; the Project context tool owns `CONTEXT.md`.

## Inputs

Use the structured `summary` as the source of truth. It should describe:

- what the user wants to build
- who the Project is for
- what should feel true when the Project is useful
- constraints, preferences, or examples the user has already given

Read only the provided inputs and any existing Project files needed to understand stable Project facts. If a load-bearing part of the Brief is missing, do not invent it; return `outcome: "blocked"` with one short message naming the missing decision.

## Output path

The canonical Brief path is `<project>/brief.json`, but you do not write it directly. The `create_brief_artifact` and `update_brief_artifact` tools own that file and its envelope.

The canonical Project context path is `<project>/CONTEXT.md`, but you do not write it directly. The `update_project_context` tool owns durable context updates.

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

## Tool sequence

1. Build the Brief fields:
   - `title`: a plain-language Project name or working title.
   - `summary`: one short paragraph explaining what the Project is.
   - `audience`: who the Project is for.
   - `success`: what should feel true when the Project is useful.
   - `sections`: one or more concrete sections with `heading` and `body`.
2. Call `create_brief_artifact` with those fields.
3. Call `update_project_context` with durable facts from the Brief, such as user vocabulary, settled constraints, product decisions, and open questions. Do not use it as a progress log.
4. If a tool returns a validation error and the fix is obvious from the inputs, correct the field and retry once. Otherwise return a small failure result.

After the tool calls finish, return only one JSON object matching `artifact_write`:

```json
{ "outcome": "complete", "message": "Created the Brief artifact and Project context.", "path": "brief.json" }
```

Use `outcome: "failure"` with `path: ""` when a tool fails and retrying is not safe. Use `outcome: "blocked"` with `path: ""` when the inputs lack a user decision needed for the Brief.

Failure and blocked examples:

```json
{ "outcome": "failure", "message": "create_brief_artifact failed validation for data.sections.0.body.", "path": "" }
```

```json
{ "outcome": "blocked", "message": "The Brief needs the intended audience before I can save it.", "path": "" }
```
