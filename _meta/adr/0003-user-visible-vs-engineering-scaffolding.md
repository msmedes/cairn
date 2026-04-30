# User-visible artifacts vs engineering scaffolding

## Status

Accepted; amended 2026-04-30 (see Amendment below).

## Context

The Guide produces multiple kinds of artifacts during a project's lifecycle: `brief.html`, the project name, PRDs, issues, `plan.html` (slice 05), and eventually the user's app source files. Two pressures pull on where these live and how they surface:

1. **The persona is the only voice the user hears.** Per `prompts/persona.md`, the user never sees code, file paths, diffs, raw PRDs, or engineering markdown. The persona translates everything technical into plain language before it reaches the user.
2. **The panel surface is where artifacts manifest.** `brief.html` lit up the panel as the Project's identity; `plan.html` lights it up again as the slice's plain-language summary. The same surface is where the user looks to see "the Guide is making something for me."

Slice 04 (slicing skills) shipped under the assumption — inherited from CONTEXT.md and ADR 0001's *"Future artifacts extend the same surface. `write_prd` and `write_issue` (slicing phase) add new entries to the `target` enum"* — that PRDs and issues were user-visible artifacts. The slicing PRs accordingly extended `set_creating` to bracket PRD and issue creation on the user's panel.

Slice 05 (plan tab) design surfaced that this conflates two distinct categories. The PRD is engineering content (templated markdown with deep modules, testing decisions, acceptance criteria for sub-agents); the issues are implementation tasks for Ralph and sub-agent dispatchers. Surfacing those to a non-technical user is the precise *"Claude Code mode"* failure that `prompts/persona.md` explicitly forbids. The user-visible artifact for the slicing phase isn't the PRD — it's `plan.html`, a plain-language summary of the slice.

This ADR establishes the boundary so future artifacts land on the right side of it.

## Decision

Two artifact categories, separated by file-system location and surface treatment.

**User-visible artifacts live at the project root:**

- `<project>/brief.html` — the Project's plain-language identity (existing, slice 01)
- `<project>/plan.html` — the current Slice's plain-language summary (slice 05)
- Eventually: the user's actual app source files at project root, browsable via the OS

User-visible artifacts:

- Are written in the persona's voice, in plain language; the user reads them directly
- Render in the Guide's panel through tabs (`Project | Plan | …`)
- Are bracketed by `set_creating(target=…)` during creation, with persona-voiced messages
- Are navigated by the user via the panel; the user does not see file paths

**Engineering scaffolding lives under `<project>/.guide/`:**

- `<project>/.guide/prds/<NN>-<slug>.md` — the slice's engineering interpretation
- `<project>/.guide/issues/<NN>-<slug>.md` — implementation tasks per slice
- Future hidden artifacts (session metadata, sub-agent state, etc.) go here

Engineering scaffolding:

- Is engineer-formatted (templates, acceptance criteria, references to deep modules)
- Is read by the Guide and sub-agents, never rendered to the user
- Is **not** bracketed by user-visible `set_creating` calls — its creation is silent on the panel
- The persona may translate sections of these into plain language **if the user explicitly asks** (per `prompts/persona.md`'s *"the PRD or issues files unless they ask"*), but the raw files are never surfaced

The dot-folder convention (`.guide/`) signals "internal" the same way `.git/` does — visible if you look, not the place the user is meant to engage.

**The slicing-phase `set_creating` brackets remain.** Slice 04-2's `target: "prd" | "issues"` enum entries stay. The clarification is in their *interpretation*: those brackets narrate the **planning phase** in user-friendly persona-voiced messages (e.g., *"Putting your plan together…"*, *"Now breaking it into pieces…"*), not the artifacts themselves. The user sees the persona working through visible moments; the engineering files those moments correspond to remain hidden under `.guide/`. Persona prompt language is updated in slice 05 to reflect this.

## Considered alternatives

- **Single artifact set: surface everything.** Render the PRD's user-relevant sections directly in a "Plan" tab. Rejected: the PRD is engineering-templated content; rendering it to a non-technical user is the precise failure mode `prompts/persona.md`'s *"Never fall into Claude Code mode"* rule guards against. The user came to escape engineering text.

- **Single artifact set: hide everything beyond the brief.** No user-visible artifacts after Scoping; the panel never updates. Rejected: dogfooding (slice 04) showed the user wants visible proof of progress after agreeing to a slice. The brief alone goes stale once Slicing and Implementing are running.

- **Co-located but tagged.** PRDs and `plan.html` at project root; tabs filter by frontmatter or filename. Rejected: fragile (relies on naming conventions to express the user-visible boundary), and a user browsing the project folder in Finder would see PRDs alongside their app code — engineering exposure leaking through the file system.

- **Engineering scaffolding under a non-dot folder (e.g., `<project>/internal/`).** Rejected: visible in default file listings. When the project folder also holds the user's actual app code (during Implementing), `internal/` sitting next to `src/` invites the user to look inside. The dot-prefix convention is a stronger "don't look here" signal because the OS hides it by default.

- **Drop slice 04-2's `prd`/`issues` `set_creating` targets entirely.** Considered during slice 05 grilling. Rejected by user feedback after dogfooding: the multi-stage panel narration *"I did like the cards that showed while it was PRDing and then while it was splicing."* The brackets are kept because their messages — written in the persona's voice — narrate the *phase*, not the *artifacts*; the user does not perceive the engineering vocabulary.

## Consequences

- **Slice 05 lands `plan.html` at project root** alongside `brief.html`, with a `Plan` tab in the panel that renders the same slideshow component as `brief.html` does.
- **Future Guide artifacts are evaluated through this lens before implementation.** Plain-language for the user → project root + tab. Engineering content for sub-agents/Guide → `.guide/` + silent creation.
- **Persona prompt updates in slice 05** to clarify that `set_creating(target="prd"|"issues")` bracket the *planning phase moments* in user-friendly messages — not literal engineering artifact creation. No code changes to slice 04-2's enum extension are needed; the framing is in the persona's prompt.
- **CONTEXT.md is updated** to introduce `Plan` and `Engineering scaffolding` as canonical terms and to correct the `User-visible artifact` entry's outdated *"the PRD and issues later"* listing.
- **The line between categories is judgment, not enforcement.** No schema or build check stops a future contributor from writing engineering markdown to project root or user-visible HTML to `.guide/`. The convention is documented here and in CONTEXT.md; correctness is reviewed via PRD-level ADR references and code review.

## Amendment — 2026-04-30

The path scheme above (`<project>/.guide/prds/...` and `<project>/.guide/issues/...`) was superseded in commit `66e8853 refactor(skills): flatten project artifact paths to <project>/{prds,issues}`. Engineering-scaffolding artifacts now live at the Project root:

- `<project>/prds/<NN>-<slug>.md`
- `<project>/issues/<NN>-<slug>.md`

The reasoning: a Guide Project already lives under `~/.guide/projects/<project>/`, which is itself hidden by the OS default. Adding a second `.guide/` segment inside each project added no real hiding — it duplicated the dot-folder convention without gaining anything — and made paths visually ugly (`~/.guide/projects/foo/.guide/issues/...`). The Finder-exposure scenario the *"Engineering scaffolding under a non-dot folder"* alternative above was guarding against does not apply: the user is not browsing the project folder in Finder, because the project folder is already inside a hidden top-level directory. The Guide panel is the user's actual file surface, and the panel does not render `prds/` or `issues/` regardless of where they live on disk.

What this amendment **does not** change:

- The two-category split (user-visible artifact vs. engineering scaffolding) stands. Categorization is judgment, not enforcement.
- Engineering scaffolding is still **silent on the panel** — no `set_creating` brackets for the artifacts themselves, no panel tabs that render PRD or issue contents to the user. Only the *planning-phase moments* are bracketed (the `prd` / `issues` `target` enum entries on `set_creating` retain their existing persona-prompt interpretation as user-friendly narration of those moments).
- The persona's translation rule (*"may translate sections only if the user explicitly asks"*) is unchanged.

In practice: the rule for *"should this artifact be visible to the user?"* is the same as the original Decision; only the engineering-scaffolding location moved one directory up. ADR 0004 (implementing-phase orchestration) and the current `write-prd` / `write-issue` skills are aligned with the post-amendment paths. CONTEXT.md is updated alongside this amendment.
