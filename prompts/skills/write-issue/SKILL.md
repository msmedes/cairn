---
name: write-issue
description: Use only after a fresh slice PRD exists under the Project's .guide/prds/ folder and the user-approved slice needs to be broken into local implementation issue files.
disable-model-invocation: false
---

Break the most recent slice PRD into independently buildable implementation issues. This is silent planning work for the Guide: do not chat with the user, do not expose implementation paths to the user, and do not write files unless the PRD supports useful issue slices.

## Input

Read the most recently modified PRD under:

`<project>/.guide/prds/`

Use only markdown PRD files in that folder. If more than one PRD exists, choose the newest file by modification time. Treat that file as the source of truth for the current slice.

If there is no PRD under `<project>/.guide/prds/`, do not create issue files. Return exactly one targeted question in the Guide's voice that asks for the missing planning input.

## Bubble-up rule

Before writing, check whether the PRD is sufficient to produce useful implementation issues. A gap is load-bearing when choosing wrongly would materially change the issue breakdown, for example:

- the user-visible behavior of the slice cannot be named
- the implementation surfaces are too vague to separate into work items
- the first demoable path or stopping point is unclear
- required data, persistence, integration, or UI behavior is unspecified
- dependencies between issue slices would be guesswork

If a load-bearing gap exists, do not write or modify issue files. Return exactly one targeted clarifying question in the Guide's voice so the persona can ask the user and re-invoke this skill after the answer. Ask only about the blocking gap. Do not include analysis, alternatives, markdown headings, file paths, or more than one question.

If the missing information is not load-bearing, make a reasonable implementation-planning judgment and continue.

## Output paths

Write issue files under:

`<project>/.guide/issues/<NN>-<slug>.md`

Create `<project>/.guide/issues/` if it does not exist; the Write tool may create parent directories as needed.

Use this naming convention:

- `NN` is copied from the source PRD filename. For `01-video-playback.md`, every issue for that slice starts with `01-`.
- Each issue gets a short kebab-case slug suffix that names the work, for example `01-video-runtime.md`, `01-playback-controls.md`, or `01-error-state.md`.
- Multiple issues for the same slice share the same `NN` prefix and differ only by slug suffix.
- Keep slugs lower-case, specific, and no more than five words after the numeric prefix.
- If re-slicing the same PRD, overwrite stale issue files for that same `NN` prefix rather than creating duplicate competing issue sets.

## Issue breakdown

Draft vertical slices, not horizontal tasks. Each issue should describe a narrow but complete path through the relevant layers, with its own verification surface. Prefer a handful of small issues over one broad issue.

Use these rules:

- Each issue is independently understandable from its file.
- Each issue is demoable or manually verifiable on its own.
- Each issue traces to the source PRD and compresses part of that PRD's user stories or implementation decisions.
- Dependencies should be minimal and explicit. Default to a simple linear chain only when later work genuinely needs earlier work to exist.
- Do not create GitHub issues. These are local markdown files only.

## Issue template

Use this exact section structure for every issue file:

```markdown
# <short issue title>

## Source

`<project-relative path to the PRD>`

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by `<other-issue-file-slug>`
```

Template rules:

- `## Source` always references the PRD path relative to the Project root, for example `.guide/prds/01-video-playback.md`.
- Omit `## Parent`. There is no upstream GitHub issue in the Project folder workflow.
- If there are no blockers, write `None - can start immediately` under `## Blocked by`.
- If there are blockers, reference other issue files by slug only, without `.md` and without GitHub issue numbers, for example `- Blocked by 01-video-runtime`.
- Acceptance criteria should be concrete checks an implementer can satisfy. Include tests or manual verification when appropriate.
- Do not include hidden reasoning, persona instructions, or this SKILL.md's text in the issue files.

After writing the files, return only a compact list of the project-relative issue paths created or updated and one short sentence describing the breakdown.
