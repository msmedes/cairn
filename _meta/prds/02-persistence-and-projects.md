# PRD — Slice 02: Persistence and projects

## Problem Statement

The wife successfully scoped a project in v0 — typed an idea, answered questions, watched a brief get written next to the chat. She closes the app. The next morning she reopens it. The brief panel still shows what she made; the chat surface is empty. The persona, which has promised in its own voice that "last time we were working on...", has no memory of last time. She is stranded between an artifact she recognizes and a conversation that has been silently erased. The surface is lying about its own state.

She also currently has no way to scope a *second* idea without overwriting the first. The v0 single-folder workspace conflates "the project she's working on" with "the only thing the app knows how to think about."

## Solution

The Guide remembers. When the wife reopens it, the chat surface shows the conversation she had last time, scrolled to where they paused. If meaningful time has gone by, the persona quietly orients her — *"Last time we were sketching out who would make the quizzes — want to keep going there, or change direction?"* — without her having to ask. If she had two ideas going, she'll be able to pick which one to come back to (the picker UI itself lands in the next slice; this slice ships the on-disk shape it will need).

Each idea now lives as a self-contained **project** under `~/.guide/projects/<slug>/`, holding the brief, the conversation, and (later) any code. When she's said enough for a brief to be written, the persona — in its own voice, not as a forced prompt — asks what to call the project, and the folder is renamed to a human-readable slug she can recognize on disk. She still never sees a path or an ID, but if she ever did look, what she'd see is a folder named after her idea, not a UUID.

## User Stories

1. As a non-technical user, I want the conversation I had yesterday to be there when I reopen the app today, so that I don't have to re-explain what I'm building.
2. As a non-technical user, I want the Guide to greet me with where we left off when I come back after meaningful time away, so that I'm oriented without having to read back through everything myself.
3. As a non-technical user, I want the Guide *not* to greet me with "last time we were working on..." if I just reopened the app two minutes after closing it, so that the recap doesn't feel mechanical or performative.
4. As a non-technical user, I want each project I'm building to be its own thing — its own conversation, its own brief, its own folder — so that scoping a second idea doesn't blow away the first.
5. As a non-technical user, I want the Guide to ask me what to call the project at a moment that feels natural in the conversation (after the brief is taking shape), so that I'm naming something I can already see, not naming a void.
6. As a non-technical user, I want the project name I give to be the one I'd recognize on disk if I ever looked, so that I'm never confronted with an opaque ID.
7. As a non-technical user, I want the Guide to handle two projects with the same name without surfacing the conflict to me, so that I can call two things "Quiz Tool" if I want to and Guide handles the disambiguation silently.
8. As a non-technical user, I want the brief panel to show the brief for whichever project I'm currently in, so that the right-hand context always matches the conversation in the chat.
9. As a non-technical user, I want the conversation to keep working even after it has been going for a while, so that long iteration doesn't degrade Guide's ability to respond.
10. As the project owner, I want session storage to live inside the project folder (not in `~/.pi/`), so that copying a project folder or initializing git in it captures everything in one place.
11. As the project owner, I want existing pi-coding-agent session APIs (`SessionManager.create` / `continueRecent` / `getEntries` / compaction) used as-is, so that I'm not re-implementing storage that already works.
12. As the project owner, I want the chat surface unchanged at the protocol level — the existing `text_delta` / `text_done` events handle replay too — so that the frontend doesn't grow new event types just for hydration.
13. As the project owner, I want the recap greeting fired as a synthetic system hint to the model rather than as a hardcoded string, so that the persona owns its voice on resume the same way it owns its voice during scoping.
14. As the project owner, I want the existing `<repo>/.workspace/` thrown away on first run of the new code, so that there is no migration ambiguity for the only user of v0 (me).
15. As the project owner, I want a single project folder layout that is forward-compatible with `git init`, future PRDs, future issues, and future source code, so that later slices don't have to reorganize the disk.
16. As the project owner, I want each deep module — project store, slug generator, hydration translator, recap trigger — testable in isolation, so that I can land them independently and the slice doesn't all have to come together at once.

## Implementation Decisions

### Modules

- **Project store** *(new, deep)*. Owns the on-disk layout under `~/.guide/projects/`. Surface: `findMostRecent()`, `create(initialMessage)`, `rename(projectId, displayName)`, `touch(projectId)` (bumps `lastOpenedAt`), `read(projectId)`, `list()`. Encapsulates folder discovery, project.json read/write, slug-collision handling, and the rename-on-naming flow. Implemented in TypeScript, lives with the sidecar so the sidecar can boot directly into a project; the Rust bridge calls the sidecar (not the store) and so doesn't need its own copy.
- **Slug generator** *(new, deep)*. Pure function. Surface: `slugify(text, opts)` returns a kebab-case slug; `withDatePrefix(slug, date)` prepends `YYYY-MM-DD-`; `disambiguate(slug, existingSlugs)` appends `-2`, `-3` until unique. Pure, fully unit-testable. The project store composes these.
- **Hydration translator** *(new, deep)*. Pure function from pi's `SessionEntry[]` to a sequence of sidecar output events (`text_delta` + `text_done` per assistant message; user messages emitted as a new event-type-equivalent the chat surface already handles, OR rendered by the sidecar via a new minimal event shape — see protocol below). Encapsulates pi's entry-tree shape so the rest of the sidecar doesn't have to think about it.
- **Recap trigger** *(new, deep)*. Pure function `(lastEntryTimestamp, now, hasInFlightTurn) -> { fire: boolean, reason: string }`. Trivially unit-testable. Used by the sidecar after `continueRecent` to decide whether to send the synthetic recap hint to the model.
- **Sidecar runtime** *(modified)*. The existing top-level handler now: (a) takes no fixed workspace; (b) on `init`, calls the project store to find or create a project; (c) configures pi with `sessionDir = <project>/sessions`; (d) on existing session, runs the hydration translator; (e) consults the recap trigger and, if firing, sends a synthetic system-hint to pi to produce the recap as a normal assistant turn. Existing message-event wiring is unchanged.
- **Rust bridge** *(modified)*. `workspace_path()` is replaced with "active project root," resolved by asking the sidecar (via a new event) at startup. `read_workspace_file` reads from the active project root, and the path-traversal guard remains. A new Tauri command `get_active_project` returns `{id, name, path, displayName}` for the frontend.
- **Frontend chat surface** *(touched lightly)*. No protocol changes. The empty state copy is unchanged — first user message implicitly creates a project. The `useWorkspaceFile` hook is reused for `brief.md` / `brief.html` exactly as it is today; what changes is the file's location, owned by the Rust bridge.
- **Persona prompt** *(modified)*. Two additions: (a) instruction to ask, conversationally, for a project name after the brief is meaningfully drafted, then to call the rename tool; (b) instruction for how to behave when given the recap system-hint on resume — short, oriented, ends with a question.

### Sidecar protocol changes

The existing protocol has events from sidecar-to-host: `ready`, `text_delta`, `text_done`, `agent_end`, `error`. For hydration we need to render *user* messages too, which the chat surface today only renders from its own `setMessages` calls (it doesn't get user-message events from the sidecar; the user types and the frontend appends locally).

Two options:
- **Add `user_message` and `assistant_message` events** for hydration. The chat surface gains a small handler for each.
- **Put hydration entirely in Rust**, where the sidecar emits a one-shot `hydrate` event with the full message list and the frontend renders it as the initial `messages` state.

Choosing the second: hydration is a one-shot, ordered, cold replay; streaming it as deltas with no actual model latency is wasteful and also makes the chat surface flash. A single `hydrate` event with `{messages: [{role, text}]}` is cleaner. The chat surface initializes its `messages` state from this event before any new turns arrive.

So new event: `hydrate { messages: [{id, role: "user" | "assistant", text, done: true}] }`. Existing events unchanged.

### Storage layout

```
~/.guide/projects/<slug>/
  project.json           # {id, name, createdAt, lastOpenedAt}
  brief.md               # source of truth
  brief.html             # generated visual
  sessions/
    <session-id>.jsonl   # exactly one in v0
```

`project.json.id` equals the current folder slug. Renaming the folder updates `project.json.id` and the in-memory cache. Pi's session JSONL is untouched by rename.

### Naming flow

Persona, after writing the brief, asks the user a conversational question ("what should I call this so we can find it again?"). The persona then invokes a tool — exposed via pi's tool ecosystem — `set_project_name(name: string)` that calls into the project store's `rename`. The tool is registered alongside pi's filesystem tools at session creation time. Failure modes (empty name, collision) are handled in the store; the tool either succeeds silently or returns a short message the persona can incorporate.

### Recap mechanism

On `continueRecent`, sidecar reads `getEntries()`. The hydration translator emits the `hydrate` event. The recap trigger inspects the last entry's timestamp vs. now and the in-flight state. If it should fire, the sidecar calls `session.prompt()` with a *synthetic* user-side or system-side hint — phrasing TBD during implementation, candidates include a system-prompt addendum or a `CustomMessageEntry` with `display: false` — instructing the model to produce a brief "last time we were working on..." reorientation. The model's response streams back through normal message-update events, so the recap is just a normal assistant turn from the chat surface's perspective. It is appended to the JSONL like any other turn.

### Defaults / paths

- `~/.guide/` resolves via `os.homedir()` in the sidecar. Rust does not own this path.
- Persona path stays at `<repo>/prompts/persona.md` for `bun tauri dev`. Packaging is deferred per the v0 PRD.
- Time threshold for recap: 30 minutes. Configurable via a constant; not exposed as a setting.
- `<repo>/.workspace/` is removed from the codebase entirely — the directory itself is left on disk for Mike to delete manually, but no code reads or writes it after this slice.

## Testing Decisions

A good test for this slice exercises behavior the user can name — *"reopening the app brings my conversation back," "two projects don't trample each other," "the recap fires when expected and not otherwise"* — not pi internals or React state shape.

- **Project store, unit (`bun test`).** Round-trip create/read; rename including collision handling; `findMostRecent` ordering; `touch` updating `lastOpenedAt`. Uses a temp directory; no mocking. Catches the layout-and-naming logic where most subtle bugs will live.
- **Slug generator, unit (`bun test`).** Tabular tests over edge cases: empty string, all-punctuation, very long input, collision paths, date-prefix shape, fallback to `untitled`. Pure function, exhaustive coverage is cheap.
- **Hydration translator, unit (`bun test`).** Given a fixture set of pi `SessionEntry[]` (built from real session-manager calls in-memory), assert the produced `hydrate` event's message list matches the expected user/assistant sequence. Skips tool entries.
- **Recap trigger, unit (`bun test`).** Tabular: `(last - now)` thresholds × `hasInFlightTurn` → expected `{fire, reason}`. Trivial.
- **Sidecar protocol smoke, integration (`bun test`).** Extension of the slice-01 test. Spawns sidecar with a temp `~/.guide/projects/` root, sends `init`, asserts `ready`. Sends a `prompt`, asserts `text_delta` → `agent_end`. Restarts the sidecar against the same project root and asserts a `hydrate` event with at least the prior user message. Skipped without API key.
- **End-to-end smoke, manual.** Open the app on a clean `~/.guide/`, type a scoping prompt, see the brief render, close. Reopen — verify the chat is repopulated and (after waiting >30 min, or by faking the threshold) the recap fires once. Open the app a second time without delay — verify no recap. Type a *different* idea after the brief — verify the project is named after the wife's chosen name and the folder slug matches.

We deliberately do not write:
- **Persona-quality unit tests** for naming or recap voice — same reasoning as slice 01; voice is tuned by reading transcripts.
- **Tauri Rust unit tests for the path resolver** — the existing path-traversal guard already has belt-and-suspenders behavior; a behavioral assertion through the smoke test is enough.
- **Tests for pi's `continueRecent` semantics** — out of scope; trust the dependency.

Prior art: `sidecar/tests/` from slice 01 (sidecar protocol smoke against real pi). The unit tests for the new modules will live alongside and follow the same `bun test` shape.

## Out of Scope

- **Project picker UI.** Cards, switching, rename-from-UI, delete-from-UI. Lands in the next slice. This slice ensures the on-disk shape supports it.
- **Multi-session per project.** Cut after grilling; iteration is "continue the same session," branching is pi's tree state (deferred), separation is "different project."
- **Tree-state / branching UI.** Pi has it; we don't expose it. Becomes a "what if?" affordance later.
- **Custom compaction summaries.** Pi defaults handle bounded context. Custom `CompactionEntry.details` hooks for Guide-specific summaries are a tuning concern that lands when transcripts justify it.
- **Persona prompt bundling for packaging.** Sidecar still reads `<repo>/prompts/persona.md` for `bun tauri dev`. Packaging is its own slice.
- **`git init` per project.** No code yet. Lands with the implementing phase.
- **Migrating `<repo>/.workspace/` content.** Discarded, not migrated. Mike is the only user.
- **In-app way to delete a project.** Manual filesystem operation in v0+1; UI lands with the picker.

## Further Notes

- **Order of build matters for momentum.** Write the slug generator and project store first with their unit tests; both are pure and require no Tauri/pi machinery. Then the hydration translator and recap trigger (also pure). Only then wire the sidecar runtime to use them. The Rust bridge changes last. Each step is independently testable and lands behind a working app at every stage.
- **The `hydrate` event is the only protocol change.** Everything else reuses existing events. If the slice ever feels like it's growing more events, that is a sign something is being conflated and worth re-examining.
- **The recap is the highest-risk piece for voice.** Read every transcript that includes a recap during dogfooding; tune the synthetic-hint phrasing iteratively. If the recap ever feels mechanical or repetitive, the threshold or the hint shape is wrong, not the model.
- **Pi version pin still matters.** The session-manager API surface used here (`create` / `continueRecent` / `getEntries` / `appendCompaction`) is stable in the current pin. Treat any pi upgrade as a separate slice with the protocol smoke as the regression gate, same as slice 01.
- **The `set_project_name` tool is the first time Guide adds its own tool to pi's registry.** Document the addition pattern carefully in the sidecar runtime so future Guide-specific tools (write-prd, write-issue) follow the same shape.
- **Risk: pi compaction firing mid-scoping.** Unlikely (scoping conversations are short by design) but worth watching. If a compaction summary lands mid-scoping it could change what the persona "remembers" about earlier answers in subtle ways. Manual smoke catches this.
