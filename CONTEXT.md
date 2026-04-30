# Guide

Guide is a native app that helps non-technical people build small, useful software for themselves and the people in their lives. The user talks to a single persona — the Guide — that owns all technical decisions; headless sub-agents do the coding silently underneath.

## Language

**Guide**:
The single voice the user talks to. Owns every technical decision and translates anything technical into plain language before it reaches the user.
_Avoid_: model, assistant, agent, AI

**Sub-agent**:
A headless worker that does actual coding under the Guide. The user never sees one directly.
_Avoid_: helper, bot

**Project**:
One app the user is building. The unit of separation in Guide — every Project is independent.
_Avoid_: workspace, app

**Session**:
One continuous conversation between the user and the Guide inside a Project. Survives across launches.
_Avoid_: chat, thread, dialogue

**Scoping**:
The first phase. A conversation in which the Guide figures out what the user wants to build, who it's for, and what "done" feels like. Ends when the Brief is written.

**Slicing**:
The second phase. The Guide breaks the Project into the smallest meaningful first chunk worth building. Produces the **Plan** (user-visible, the slice's plain-language summary) and **Engineering scaffolding** (hidden PRD and issues for sub-agents to implement against).

**Implementing**:
The third phase. Sub-agents do the actual coding one piece at a time while the Guide narrates calmly and translates technical mess into plain language. Ends when every piece is built, the Project builds cleanly, and the user has confirmed by trying it.

**Brief**:
The plain-language plan the Guide writes near the end of Scoping. The user-visible source of truth for what the Project is. One kind of **User-visible artifact**.

**Plan**:
The plain-language summary of the current Slice that the Guide writes at the end of Slicing — what's being built first, how it'll come together, and what's coming next. Lives at `<project>/plan.html`; renders in the Plan tab of the project panel. Distinguished from the PRD, which is engineering content the panel never renders. Overwritten when re-slicing; the latest is canonical.
_Avoid_: roadmap, slice doc, plan-doc

**Tasks tab**:
The Implementing-phase user-visible artifact. A plain-language checklist with one entry per piece of the current Slice, ticking off as each one is built. Lives at `<project>/tasks.html`; renders in the Tasks tab of the project panel. Shares its plain-language descriptions with the Plan's "pieces I'll work through" section — the Plan describes what will be built, the Tasks tab shows what has been built. Distinguished from the PRD and issues, which are **Engineering scaffolding**. Overwritten on each tick; the latest is canonical.
_Avoid_: progress, status, todos, implementation tab

**User-visible artifact**:
Anything the user sees rendered in the Guide's panel: the Brief, the Plan, the Tasks tab, and eventually the app itself. Lives at the Project root and is navigated via panel tabs (`Project | Plan | Tasks | …`). Distinguished from **Engineering scaffolding**, which the Guide handles silently.
_Avoid_: deliverable, output

**Engineering scaffolding**:
Internal artifacts that the Guide and Sub-agents read but the user never sees in the panel. Lives at the Project root in `prds/` and `issues/` subdirectories that no panel tab renders. Includes the **PRD** (engineering interpretation of a Slice) and **issues** (implementation tasks). The persona may translate sections of these into plain language only if the user explicitly asks; the raw files are never surfaced in the UI. See ADR 0003 (and its 2026-04-30 amendment for the current path scheme).
_Avoid_: internal artifacts, hidden files

**Recap greeting**:
The Guide's opening turn when the user returns after a meaningful gap, summarizing where they left off so the conversation can continue naturally.

## Relationships

- A **Project** contains exactly one **Session** (in v0).
- A **Session** moves through **Scoping** → **Slicing** → **Implementing**, in that order, one slice at a time.
- **Scoping** ends with a **Brief**. **Slicing** ends with the **Plan** (user-visible) and **Engineering scaffolding** (hidden). **Implementing** ends with working software, with progress visible in the **Tasks tab** along the way.
- A **Brief**, the **Plan**, and the **Tasks tab** are kinds of **User-visible artifact**; the app itself becomes one once Implementing produces it. The **PRD** and **issues** are **Engineering scaffolding**, not user-visible.
- The **Guide** is the only voice the user hears; **Sub-agents** are silent and invisible.
- A **Recap greeting** opens a returning **Session** when enough time has elapsed.

## Example dialogue

> **Dev:** "When the Guide finishes Scoping, where does the Brief live?"
> **Domain expert:** "Inside the Project. One Project, one Brief — written from what the user said during the Session."
> **Dev:** "And if the Guide spawns a Sub-agent during Implementing, the user sees it work?"
> **Domain expert:** "No — Sub-agents are invisible. The Guide narrates what's happening; the Sub-agent's output is a User-visible artifact only after the Guide has translated and surfaced it."
> **Dev:** "What if the user closes the app and comes back the next day?"
> **Domain expert:** "Same Project, same Session — the Guide opens with a Recap greeting and picks up where they left off."

## Flagged ambiguities

- **"workspace"** was the v0 term for the single Project folder. Replaced by **Project**; should not appear in user-facing language or new code.
- **"app"** in conversation usually means what the user is building (the **Project**), not Guide itself. Disambiguate when context is unclear.
- **"agent"** is overloaded — in the wider AI ecosystem it can mean the Guide, a Sub-agent, or pi-coding-agent. Inside Guide, prefer **Guide** or **Sub-agent** explicitly.
