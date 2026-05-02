# Default to pi-coding-agent primitives

## Status

Accepted.

## Context

Cairn is built on the pi-coding-agent harness (`@mariozechner/pi-coding-agent`). The reason it is a runtime dependency, not a thin wrapper around the Anthropic SDK, is so the project can stand on the harness's primitives instead of rebuilding them. Skills, custom tools, sub-agents, session management, resource loading, project-context-file discovery, system-prompt overrides — these are all features of pi.dev that come for free when used, and that get paid for twice when ignored.

The cost of ignoring them is invisible at decision time. Bespoke sidecar code feels like control: it fits the shape of the immediate problem more tightly than a general-purpose primitive does. The cost surfaces later, as parallel mechanisms for things the harness already handles and a sidecar surface area that grows past what the team can keep in its head.

This ADR exists because the slice-04 (slicing) design surfaced the tendency directly. The first instinct was to design `write_prd` as a custom sidecar tool that would make its own Anthropic call — bypassing pi.dev's skills feature, which already supports exactly this case via `additionalSkillPaths` on `DefaultResourceLoader`. The course-correction during design is what motivated writing this down.

## Decision

When pi.dev provides a primitive that fits the problem, use it. Custom sidecar code is the fallback, not the default. The bar for writing custom code is *"pi.dev's primitive does not fit"*, not *"a custom version would be slightly more elegant."*

In practice:

- **Instruction-following work in the agent's own context** — write a PRD per template, compose issues from a PRD, follow a checklist of operations — is a pi.dev **skill**, placed under `prompts/skills/<name>/SKILL.md` and wired via `DefaultResourceLoader`'s `additionalSkillPaths` option.
- **Side-effecting actions the persona must declare** — set indicator state, rename a project, name a project — are pi.dev **custom tools**, registered via `customTools` on `createAgentSession` (existing pattern in `sidecar/cairn-tools.ts`).
- **Spawned, isolated work** — code generation, test runs, anything where context isolation matters — is a pi.dev **sub-agent / sub-session**.
- **File-system layout** for project context, agents files, and session storage follows pi.dev's existing conventions where they don't actively conflict with Cairn's product surface.

When pi.dev does not provide a fitting primitive, or its primitive forces a worse user experience than Cairn can deliver from outside, write sidecar code.

## Considered alternatives

- **Default to bespoke sidecar code; use pi.dev only for the agent loop.** The implicit default in early slices, and the route surfaced during slice-04 design. Rejected: it negates the reason pi.dev is a dependency. If we are going to write our own skill loader, our own tool dispatch, and our own context-file plumbing, the dependency cost stops earning its keep.
- **Use pi.dev for everything; never write sidecar code.** Rejected: Cairn has product responsibilities that are not generic agent-harness concerns — `ProjectStore`, recap-trigger logic, the `creating_started` event over the existing stdio protocol, the active-project lifecycle. pi.dev is the substrate; Cairn is the product on top. Drawing the line in the wrong place leaks Cairn product concerns into pi.dev or starves pi.dev's own surface.

## Consequences

- **Slice-04 (slicing) lands as pi.dev skills, not as new sidecar tools.** `write-prd` and `write-issue` are SKILL.md files under `prompts/skills/`, not `defineTool` entries in `cairn-tools.ts`. The existing comment in `sidecar/cairn-tools.ts:18-21` that names them as future *tools* is wrong post-slice-04 and is corrected as part of that slice.
- **Future Cairn capabilities are evaluated through this lens before implementation.** When proposing a new sidecar tool, the question is *"is this a side effect or instruction-following work?"* — the latter is a skill.
- **The decision to write sidecar code becomes a deliberate one.** "Default to pi.dev" is the cheap path; a custom sidecar tool now requires a one-line justification of why pi.dev's primitive doesn't fit. That friction is the point — it puts the cost where it belongs.
- **Audit existing sidecar code for missed primitives.** `set_creating` and `set_project_name` are correct as tools (declared side effects). Worth confirming no current sidecar logic is reimplementing a pi.dev primitive that already exists; not for slice-04, but as a follow-up audit.
