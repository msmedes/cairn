---
name: write-prd
description: Use only after the project brief is concrete, the Cairn has proposed a smallest meaningful first slice, and the user has agreed to that slice; silently draft the slice PRD.
disable-model-invocation: false
response_schema: artifact_write
args:
  type: object
  required:
    - slice_intent
  properties:
    project_root:
      type: string
      description: Absolute path to the active Project root.
    slice_intent:
      type: string
      description: The agreed smallest meaningful first slice, including any user clarifications.
    brief_path:
      type: string
      description: Optional path to the saved Brief; defaults to .cairn/brief.json.
---

Write a product requirements document for the user-approved slice. This is silent planning work for the Cairn: do not chat with the user, do not expose implementation paths to the user, and do not write anything unless the inputs support a useful PRD.

## Inputs

Use both sources together:

1. `<project>/.cairn/brief.json`: the saved Brief artifact for the Project. Treat its `data` as the primary source of truth for what the user is trying to build, who it is for, and what should feel true when the Project is useful.
2. The current Session context: the slice the Cairn proposed, the user's agreement or redirect, and any clarifications already given during Slicing.

If the Brief and Session conflict, prefer the most recent explicit user direction in the Session, but keep the PRD consistent with the Brief's product intent.

## Bubble-up rule

Before writing, check whether a load-bearing dimension of this slice is missing. A dimension is load-bearing when choosing wrongly would materially change what gets built, for example:

- the main actor or audience for the slice is unclear
- the core workflow or first screen cannot be named
- a required content source, data source, or integration is unspecified
- the success behavior or stopping point of the slice is ambiguous
- the user's agreed slice is too vague to distinguish from the whole Project

If a load-bearing dimension is missing, do not write or modify a PRD file. Return exactly one targeted clarifying question in the Cairn's voice so the persona can ask the user and re-invoke this skill after the answer. Ask only about the blocking gap. Do not include analysis, alternatives, markdown headings, file paths, or more than one question.

If the missing information is not load-bearing, make a reasonable product judgment and continue.

## Output path

Write the PRD to:

`<project>/.cairn/prds/<NN>-<slug>.md`

Create `<project>/.cairn/prds/` if it does not exist; the Write tool may create parent directories as needed.

Use this naming convention:

- `NN` is a zero-padded two-digit slice number.
- The first slice is `01`.
- If existing PRDs are present and the Cairn is drafting a new later slice, use the next available number.
- If the Cairn is re-slicing the current agreed first slice, reuse `01` and overwrite the prior `01-*.md` file rather than creating a second competing first slice.
- `<slug>` is derived from the slice title, kebab-cased, lower-case, and no more than five words.
- Keep the slug specific enough to distinguish the slice, for example `01-video-playback.md` or `01-question-screen.md`.

## PRD template

Use this exact section structure, matching the repo's `/to-prd` template:

```markdown
# PRD — Slice <NN>: <short title>

## Problem Statement

The problem from the user's perspective. Be concrete. Describe what they are trying to do and what is currently in their way.

## Solution

The solution from the user's perspective. Describe what they will experience, not a list of files to edit.

## User Stories

A numbered list of user stories in this form:

1. As a <actor>, I want <feature>, so that <benefit>

Cover the happy path, edge cases, owner concerns, and important error states. Aim for 8-15 stories for a meaningful slice.

## Implementation Decisions

Document the implementation decisions that matter for this slice:

- modules or surfaces likely to be built or modified, and their responsibilities
- important interfaces, data shapes, state, or persistence behavior
- technical clarifications inferred from the Brief or Session
- architecture decisions and the reasoning behind them
- defaults or naming conventions when they affect later implementation

Do NOT include specific file paths or code snippets. They go stale fast. Prefer stable module or behavior descriptions over brittle line-level instructions.

## Testing Decisions

Document how this slice should be verified:

- what makes a good test for the slice from the user's perspective
- which behavior or modules should be covered
- relevant prior test patterns if visible from the Project
- tests deliberately not included and why
- any manual smoke checks that should happen before the slice is considered done

## Out of Scope

List things deliberately excluded from this slice, each with a brief reason or pointer to where it belongs.

## Further Notes

Capture sequencing dependencies, risks, gotchas, follow-up decisions, or anything the implementer should know before turning the PRD into issues.
```

## Writing guidance

- The PRD is for downstream planning and implementation, not for the end user. Be specific enough that `write-issue` can turn it into small implementation issues.
- Keep the language grounded in the user's Project and Brief. Do not produce a generic product template.
- Make the slice narrow: the smallest meaningful first chunk worth building, not the entire Project.
- Include enough implementation detail to make the slice buildable, while keeping user-visible behavior separate from engineering decisions.
- Do not mention that the PRD came from a skill, do not mention this SKILL.md, and do not include hidden reasoning.

After writing the file, return only one JSON object matching `artifact_write`:

```json
{ "outcome": "complete", "message": "PRD written.", "path": "prds/01-slice-name.md" }
```

Use the actual Cairn storage-relative PRD path in `path`, for example `prds/01-video-playback.md`. Do not include the `.cairn/` prefix in the returned path.
