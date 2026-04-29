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
The second phase. The Guide breaks the Project into the smallest meaningful first chunk worth building. Produces a PRD and issues, written silently in the Guide's voice.

**Implementing**:
The third phase. Sub-agents do the actual coding while the Guide narrates calmly and translates technical mess into plain language.

**Brief**:
The plain-language plan the Guide writes near the end of Scoping. The user-visible source of truth for what the Project is.

**User-visible artifact**:
Anything the user can see — the Brief now, the PRD and issues later, eventually the app itself. Distinguished from hidden engineering work, which the Guide handles silently.
_Avoid_: deliverable, output

**Recap greeting**:
The Guide's opening turn when the user returns after a meaningful gap, summarizing where they left off so the conversation can continue naturally.

## Relationships

- A **Project** contains exactly one **Session** (in v0).
- A **Session** moves through **Scoping** → **Slicing** → **Implementing**, in that order, one slice at a time.
- **Scoping** ends with a **Brief**. **Slicing** ends with a PRD and issues. **Implementing** ends with working software.
- A **Brief** is one kind of **User-visible artifact**; the PRD, the issues, and the app itself are others.
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
