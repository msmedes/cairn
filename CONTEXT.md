# Cairn

Cairn is a native app that helps non-technical people build small, useful software for themselves and the people in their lives. The user talks to a single persona — the Cairn — that owns all technical decisions; headless sub-agents do the coding silently underneath.

## Language

**Cairn**:
The single voice the user talks to. Owns every technical decision and translates anything technical into plain language before it reaches the user.
_Avoid_: model, assistant, agent, AI

**Sub-agent**:
A headless worker that does actual coding under the Cairn. The user never sees one directly.
_Avoid_: helper, bot

**Project**:
One app the user is building. The unit of separation in Cairn — every Project is independent.
_Avoid_: workspace, app

**Session**:
One continuous conversation between the user and the Cairn inside a Project. Survives across launches.
_Avoid_: chat, thread, dialogue

**Scoping**:
The first phase. A conversation in which the Cairn figures out what the user wants to build, who it's for, and what "done" feels like. Ends when the Brief is written.

**Slicing**:
The second phase. The Cairn breaks the Project into the smallest meaningful first chunk worth building. Produces the **Plan** (user-visible, the slice's plain-language summary) and **Engineering scaffolding** (hidden PRD and issues for sub-agents to implement against).

**Implementing**:
The third phase. Sub-agents do the actual coding one piece at a time while the Cairn narrates calmly and translates technical mess into plain language. Ends when every piece is built, the Project builds cleanly, and the user has confirmed by trying it.

**Brief**:
The plain-language plan the Cairn writes near the end of Scoping. The user-visible source of truth for what the Project is. One kind of **User-visible artifact**, backed by schema-validated **Artifact data**.

**Plan**:
The plain-language summary of the current Slice that the Cairn writes at the end of Slicing — what's being built first, how it'll come together, and what's coming next. Backed by schema-validated **Artifact data** and rendered in the Plan tab of the project panel. Distinguished from the PRD, which is engineering content the panel never renders. Overwritten when re-slicing; the latest is canonical.
_Avoid_: roadmap, slice doc, plan-doc

**Tasks tab**:
The Implementing-phase user-visible artifact. A plain-language checklist with one entry per piece of the current Slice, keyed by issue-derived task slugs and updated as each piece moves through implementation. Backed by schema-validated **Artifact data** and rendered in the Tasks tab of the project panel. Shares its plain-language descriptions with the Plan's "pieces I'll work through" section — the Plan describes what will be built, the Tasks tab shows what has been built. Distinguished from the PRD and issues, which are **Engineering scaffolding**.
_Avoid_: progress, status, todos, implementation tab

**User-visible artifact**:
Anything the user sees rendered in the Cairn's panel: the Brief, the Plan, the Tasks tab, and eventually the app itself. The Cairn or a Sub-agent may supply the content, but the app owns the visual presentation. Distinguished from **Engineering scaffolding**, which the Cairn handles silently.
_Avoid_: deliverable, output

**Artifact data**:
Structured JSON content that backs a **User-visible artifact** independently of its visual presentation.
_Avoid_: generated HTML, arbitrary artifact

**Artifact schema**:
A type-specific contract for one kind of **Artifact data**, such as Brief data, Plan data, or Tasks data.
_Avoid_: generic document schema, content blocks

**Project context**:
Engineering scaffolding at `<project>/CONTEXT.md` that captures durable Project facts, terms, constraints, and decisions for the Cairn and Sub-agents.
_Avoid_: project log, scratchpad, user-facing context

**Engineering scaffolding**:
Internal artifacts that the Cairn and Sub-agents read but the user never sees in the panel. Lives at the Project root in files and directories that no panel tab renders. Includes **Project context**, the **PRD** (engineering interpretation of a Slice), and **issues** (implementation tasks). The persona may translate sections of these into plain language only if the user explicitly asks; the raw files are never surfaced in the UI. See ADR 0003 (and its 2026-04-30 amendment for the current path scheme).
_Avoid_: internal artifacts, hidden files

**Recap greeting**:
The Cairn's opening turn when the user returns after a meaningful gap, summarizing where they left off so the conversation can continue naturally.

## Relationships

- A **Project** contains exactly one **Session** (in v0).
- A **Session** moves through **Scoping** → **Slicing** → **Implementing**, in that order, one slice at a time.
- **Scoping** ends with a **Brief**. **Slicing** ends with the **Plan** (user-visible) and **Engineering scaffolding** (hidden). **Implementing** ends with working software, with progress visible in the **Tasks tab** along the way.
- A **Brief**, the **Plan**, and the **Tasks tab** are kinds of **User-visible artifact**; the app itself becomes one once Implementing produces it. The **PRD** and **issues** are **Engineering scaffolding**, not user-visible.
- **Artifact data** captures what a **User-visible artifact** says; the Cairn app decides how that content is rendered in the panel.
- Each core **User-visible artifact** has its own **Artifact schema**; the Cairn does not use a generic document-block schema for the Brief, Plan, or Tasks tab.
- **Project context** is created when the **Brief** is created and then updated explicitly when durable Project knowledge changes.
- The **Cairn** is the only voice the user hears; **Sub-agents** are silent and invisible.
- A **Recap greeting** opens a returning **Session** when enough time has elapsed.

## Example dialogue

> **Dev:** "When the Cairn finishes Scoping, where does the Brief live?"
> **Domain expert:** "Inside the Project. One Project, one Brief — written from what the user said during the Session."
> **Dev:** "And if the Cairn spawns a Sub-agent during Implementing, the user sees it work?"
> **Domain expert:** "No — Sub-agents are invisible. The Cairn narrates what's happening; the Sub-agent's output is a User-visible artifact only after the Cairn has translated and surfaced it."
> **Dev:** "What if the user closes the app and comes back the next day?"
> **Domain expert:** "Same Project, same Session — the Cairn opens with a Recap greeting and picks up where they left off."

## Flagged ambiguities

- **"workspace"** was the v0 term for the single Project folder. Replaced by **Project**; should not appear in user-facing language or new code.
- **"app"** in conversation usually means what the user is building (the **Project**), not Cairn itself. Disambiguate when context is unclear.
- **"agent"** is overloaded — in the wider AI ecosystem it can mean the Cairn, a Sub-agent, or pi-coding-agent. Inside Cairn, prefer **Cairn** or **Sub-agent** explicitly.
- **"`brief.html` / `plan.html` / `tasks.html`"** historically meant model-generated HTML documents. Resolved: Brief, Plan, and Tasks are user-visible surfaces backed by schema-validated JSON Artifact data; old HTML artifacts are not supported going forward.
- **"template"** can mean a visual component or a model-fillable document skeleton. Resolved: for core user-visible artifacts, the template is the app-owned component; the model supplies type-specific Artifact data through tools.
