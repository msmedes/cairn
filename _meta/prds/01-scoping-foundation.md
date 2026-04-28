# PRD — Slice 01: Scoping foundation

## Problem Statement

A non-technical person has an idea for a small piece of software — a quiz tool for work, a helper for their friend group — but every existing AI coding tool either drops them into a code-shaped surface they can't navigate, or treats their first vague sentence as the entire spec and silently builds the wrong thing. They give up after one bad session. They need a front door that asks them what they want, in plain language, and writes down what they said in a way they can read back.

## Solution

A native desktop app whose front door is one person — the Guide — running a short, kind, Socratic conversation. The user types what they have in mind. The Guide asks a small number of concrete questions, in plain language, until it has enough to write a one-page summary of the project. The summary appears in a panel next to the chat as it's being written. When the Guide judges it has enough, the brief is saved as a markdown file in a workspace folder on the user's machine. The user has produced a real artifact — a project brief — without knowing they did "scoping."

The user never sees code, file paths, error messages, terminal output, stack traces, tool calls, or diffs. The chat surface is the only place text appears, and the persona is the only voice that produces it.

## User Stories

1. As a non-technical user, I want to open the app and see a clear, friendly invitation to describe my idea, so that I'm not staring at an empty terminal-looking screen.
2. As a non-technical user, I want to type a vague idea ("a quiz app for training videos") and have the Guide ask follow-up questions, so that I don't have to know how to phrase a complete spec.
3. As a non-technical user, I want each question to be one short, concrete thing in plain language, so that I don't feel grilled or confused.
4. As a non-technical user, I want to see a project brief growing in a panel next to the chat as I answer, so that I can see what the Guide is taking from my answers and catch misunderstandings early.
5. As a non-technical user, I want to never see code, file paths, error messages, terminal output, or stack traces, so that the experience never breaks the persona of "talking to someone helpful."
6. As a non-technical user, I want the Guide to write the brief to a file when there's enough information, and tell me where it saved it in plain language, so that I have a real artifact at the end of the conversation.
7. As a non-technical user, I want the Guide's voice to feel like a thoughtful friend — short sentences, no jargon, no "great idea!" — so that the experience feels respectful of my intelligence.
8. As a non-technical user, if the Guide doesn't understand my answer, I want it to ask a clarifying question rather than guessing, so that the brief reflects what I actually meant.
9. As a non-technical user, if the Guide hits a technical snag while writing the brief, I want it to say "I hit a snag, let me try again" in plain language, so that I never see a stack trace or error code.
10. As the project owner, I want to start the app with a single command (`bun tauri dev`), so that v0 has zero installation ceremony for me to demo.
11. As the project owner, I want the persona prompt to live in a versionable text file (not hardcoded in source), so that I can iterate on the voice without recompiling the Rust binary.
12. As the project owner, I want all sub-agent tool calls (file reads/writes, etc.) to be invisible to the user but visible to me in a developer log, so that I can debug without polluting the user surface.
13. As the project owner, I want the Guide to use pi-coding-agent's session machinery, with our persona as the system prompt, so that I inherit pi's session handling, model resolution, tool ecosystem, and tree state rather than reimplementing them.
14. As the project owner, I want the workspace path (where the brief gets written) to be configurable, so that I can later support multiple projects without rearchitecting.

## Implementation Decisions

- **Top-level architecture**: Tauri 2 desktop app. Rust process owns the window, IPC, and child-process lifecycle. React + TypeScript frontend renders the UI. A Bun-run Node sidecar embeds `@mariozechner/pi-coding-agent` and is the only place the agent runs. The frontend never talks to the agent directly; everything goes Rust ⇄ sidecar.
- **Sidecar protocol**: line-delimited JSON over the sidecar's stdin/stdout. Inputs from Rust: `init` (workspace path + persona path), `prompt` (user message). Outputs from sidecar: `ready`, `text_delta`, `text_done`, `tool_start`, `tool_end`, `agent_end`, `error`. Choosing JSONL over a richer transport keeps the sidecar testable in isolation with `bun test` and a spawn helper.
- **Persona delivery**: persona prompt lives in `prompts/persona.md` and is read by the sidecar at init. It is passed to pi via `DefaultResourceLoader`'s `systemPromptOverride`. `appendSystemPromptOverride` is set to `() => []` to prevent pi from appending its default `APPEND_SYSTEM.md`, which would dilute the persona's instructions.
- **Session shape**: in-memory only (`SessionManager.inMemory()`). No persistence. No resume. If the user closes the window mid-conversation, they start fresh next time. Persistence is a separate slice.
- **Tool visibility**: the sidecar does emit `tool_start`/`tool_end` events, but the chat-surface module ignores them by default. They route to a developer log channel (read by Rust, logged to stderr in dev). The persona is responsible for any user-visible narration; tool calls are invisible.
- **Workspace**: a single fixed v0 workspace at `<repo>/.workspace/`. The sidecar `chdir`s into it on init so pi's filesystem tools operate inside it. The brief lands at `.workspace/project-brief.md`. Multi-project support is out of scope.
- **Live brief rendering**: the frontend polls `.workspace/project-brief.md` every 1 second via a Tauri command and re-renders its content in the Project tab when it changes. Polling, not a watcher, because Tauri's file-watcher plugin adds setup complexity disproportionate to v0's needs.
- **UI layout**: two columns. Left column: chat surface (scrolling message list + input at the bottom). Right column: tabbed panel; v0 has a single tab, "Project," that renders `.workspace/project-brief.md`. Window default 1280×800.
- **Streaming**: the chat surface appends `text_delta` events into the current assistant message in real time. On `text_done`, the message is finalized. There's no fancy typewriter effect; deltas are appended as they arrive.
- **Auth**: pi reads model credentials via its own `AuthStorage`. v0 expects the user has either set `ANTHROPIC_API_KEY` in the environment or run `pi`'s OAuth flow once. No in-app auth UI — that's a later slice.
- **Error surfacing**: sidecar errors land on a developer log channel; the user-visible chat shows nothing technical. On a hard failure, the persona is responsible for recovering ("I hit a snag, let me try again"); the surface only signals visible state if the sidecar dies entirely (a small "lost connection" indicator, deferred if not trivial).
- **Bun, not npm/Vite at build time**: the sidecar runs under Bun (the user's stack); the React frontend builds with Vite (Tauri default). Bun is sufficient for both processes.

### Modules to build

- **Sidecar runtime** — Node/TS module that wraps pi-coding-agent. Single class/object exposing `init(workspacePath, personaPath)` and `prompt(text)`, emitting events to stdout. Deep module: hides pi's loader/session/event mess behind a stable, narrow JSONL interface. Independently runnable with `bun sidecar/index.ts` for testing without Tauri.
- **Sidecar bridge (Rust)** — Tauri-state-managed module that owns the child-process handle, the stdin writer, and a stdout-line reader task. Exposes Tauri commands `start_session(workspace, personaPath)` and `send_prompt(text)`. Forwards parsed events to the frontend via Tauri's event system. Deep module: encapsulates child-process lifecycle, line buffering, JSON parsing, error handling.
- **Workspace watcher (React hook)** — `useWorkspaceFile(path: string, intervalMs: number): string` — polls a file via a Tauri `read_workspace_file` command and returns its current contents. Reusable for any workspace artifact (PRDs, issues) in future slices.
- **Chat surface (React)** — pure presentation: receives a `messages` array and an `onSend(text)` callback, renders a scrolling list of user/assistant messages and a sticky input. No knowledge of pi, the sidecar, or events. Deep module by being completely decoupled from transport.

## Testing Decisions

A good test for this slice exercises external behavior — what the user sees, and what artifacts get produced — rather than internal pi mechanics or React component innards. Two layers:

- **Sidecar protocol smoke test (automated, `bun test`)**: spawns the sidecar binary as a subprocess, writes an `init` followed by a `prompt` on stdin, asserts the sequence of emitted event types is sensible (at minimum `ready` → at least one `text_delta` → `agent_end`). Catches protocol regressions and pi version-bump breakage independent of agent behavior. Mocks no models — runs against the real pi-coding-agent. Skipped in CI without an API key; runs locally.
- **End-to-end smoke (manual, scripted)**: launch app, type a representative scoping prompt ("I want a quiz app for training videos"), verify (a) the Guide responds in the kind/concrete tone defined in `prompts/persona.md`, (b) the project brief panel shows content within ~10 s, (c) the brief reflects the user's stated intent, (d) no technical jargon, file paths, errors, or stack traces appear in the chat. This is the load-bearing test for v0; run it after every persona-prompt iteration.

We deliberately do not write:
- **Persona-quality unit tests** — voice is tuned by reading transcripts, not asserting strings.
- **pi-coding-agent internals tests** — out of scope; trust the dependency.
- **React snapshot tests** — visual inspection is faster than maintaining snapshots for a v0 surface that will change.
- **Cross-platform tests** — v0 is macOS-only.

Prior art: none in this repo (greenfield).

## Out of Scope

- **Slicing phase** — generating PRDs and issues from the brief. That's the next slice.
- **Implementing phase** — running ralph against issues, narrating sub-agent work, demo runner. Later slices.
- **Tree-state rewind / undo** — pi has tree state; we don't expose it in v0. The user starts fresh each session.
- **Session persistence and resume** — every launch is a new session.
- **Multi-project support** — single hardcoded workspace.
- **File watcher** — replaced by 1 s polling; revisit if poll lag becomes a UX problem.
- **In-app API key configuration** — relies on pi's existing auth setup.
- **Production packaging / signing / distribution** — runs via `bun tauri dev` only.
- **Skill ports** (`/to-prd`, `/to-issues`) — persona handles brief-writing inline. Real skill ports come with the slicing slice.
- **Markdown rendering** — Project tab renders the brief as plain text or a minimal markdown component; styling is deferred.
- **Sub-agent isolation / orchestrator pattern** — single-context, single-persona for v0; no headless sub-agents yet.
- **Async / notify-when-done** — scoping is short and synchronous.

## Further Notes

- **The persona prompt is the moat.** The single highest-leverage artifact for perceived quality is `prompts/persona.md`. Treat it as v0's primary deliverable. Iterate by running the manual smoke test, reading the resulting transcripts, and editing — don't optimize anything else until the voice feels right.
- **`appendSystemPromptOverride: () => []`** is required when constructing pi's `DefaultResourceLoader`. Without it, pi appends its `APPEND_SYSTEM.md` from `~/.pi/agent` or `<cwd>/.pi`, which is coding-agent-flavored guidance that dilutes our Socratic-guide persona.
- **The sidecar process is bun, not node.** Either works for pi, but the user's stack is bun and `bun run sidecar/index.ts` Just Works without a transpile step. Long-term, packaging the sidecar as a compiled binary (`bun build --compile`) and registering it as a Tauri sidecar binary removes the bun-must-be-installed dependency for end users. That's a packaging slice.
- **Pi version pin.** `@mariozechner/pi-coding-agent` is pre-1.0 and moves quickly. Pin a specific version in `package.json` and treat upgrades as a separate slice with the protocol smoke test as the regression gate.
- **The "implementing" persona language is a lie in v0.** The persona prompt mentions implementing because that's the ultimate vision, but in v0 the agent never enters that phase. If the user describes an idea and the agent says "I'll start building," that's a persona bug — the agent should stop at the brief and say "here's what I have so far, let's keep going if you want." Watch for this in transcripts.
- **Order of build matters for momentum.** Build the sidecar runtime first and run it standalone with the smoke test (no Tauri). Then add the Rust bridge. Then the React surface. Each layer testable before the next gets added. This is the disciplined inversion of "scaffold the whole thing then wire it up."
