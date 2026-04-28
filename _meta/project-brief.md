# Project brief — Guide

## What it is

A native (Tauri) app that helps non-technical people build small, useful software for themselves and the people around them, by guiding them through a workflow they don't know exists: scope what you want, slice it into a first chunk, build that chunk, repeat.

The user talks to a single voice — the Guide — that owns all the technical decisions. Sub-agents do the actual coding silently underneath, on a pi.dev-based harness. The user never sees code, diffs, errors, or terminal output.

## Who it's for

Two named users for v0:
- The owner's wife — has work-adjacent ideas (e.g. a video quiz tool for training).
- The owner's friend — wants to build small group-utility apps (e.g. a D&D helper for their group).

Generalizes to: curious non-technical people who have an idea for a small app and have given up on existing AI coding tools because the surface is overwhelming.

## What success looks like

For v0:
- The owner's wife can sit down with the app, describe an idea in her own words, answer ~5 short questions, and see a `project-brief.md` get written that reflects what she said.
- She doesn't see any code, errors, file paths, or terminal output during the conversation.
- She doesn't feel interrogated; the conversation feels like talking to a thoughtful friend.

This is *not* yet end-to-end app-building. v0 proves the **scoping** experience works for a non-technical user. Slicing and implementing land in v1.

## Constraints

- Native app (Tauri 2), looks like a website.
- Single user-facing persona; sub-agents are headless.
- Project artifacts are local files in a folder (no GitHub, no cloud).
- pi.dev (`@mariozechner/pi-coding-agent`) as the embedded harness.
- Model-agnostic in spirit; v0 hardcodes one provider behind pi's resolution.
- Learning project, not a product (yet). Ship the rough version, learn, iterate.

## Non-goals (for v0)

- Slicing and implementing phases — deferred to v1.
- Tree-state rewind — deferred. Users get a fresh session in v0; if they want to redo, they restart.
- Session resume / checkpoints — deferred.
- Live preview of the app being built — deferred (no implementing yet).
- Multi-project support — v0 has one workspace.
- Skill ports of `/to-prd`, `/to-issue` — v0 persona does scoping inline; formal skills land when slicing does.
- Distribution / packaging — v0 runs locally via `bun tauri dev`; no signed bundles.
