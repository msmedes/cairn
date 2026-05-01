# Grill context — Slice 02: Persistence and projects

This document captures the shared vocabulary, verified library behavior, and locked-in decisions reached during a /grill-me session for the next slice. It exists so the PRD and issues that follow inherit the same language and don't relitigate settled questions.

## Why this slice (and not the alternatives)

Three options were on the table for the next slice:

1. Session persistence in the user's workspace
2. Session continuation across launches
3. Slicing automation (taking grill-me output and threading it into issues automatically)

After grilling, **(1)+(2) won as a single combined slice**. Drivers:

- The wife successfully completed a v0 scoping session, validating that the persona/brief loop works end-to-end.
- The concrete pain she would hit on the next visit: the brief persists on disk, but the conversation that produced it does not. The surface is currently lying about its state — the project panel shows context the chat surface has lost.
- The persona prompt explicitly promises continuity ("Last time we were working on..."). With in-memory sessions, that promise is a lie on every relaunch.
- Pi-coding-agent already provides the storage half (`SessionManager.create` / `continueRecent` over JSONL). The work is mostly in the layer above pi: project folders, slug naming, hydration, and the recap greeting.
- Slicing-as-the-next-phase was deferred. Building the slicing UX on top of evaporating sessions would produce an unrealistic test surface, since long slicing conversations would never survive a relaunch.

## Glossary (shared vocabulary)

| Term | Meaning |
|---|---|
| **Project** | One app the user is building. Lives at `~/.guide/projects/<slug>/`. The unit of separation in Guide; eventually `git init` will wrap it. |
| **Workspace** | *Deprecated as a Guide-internal term.* Used to mean the v0 single-folder; from here on, say "project." |
| **Session** | One continuous conversation with the persona inside a project. Stored as one pi JSONL at `<project>/sessions/<session-id>.jsonl`. Exactly one per project in v0. Append-only; tree-structured underneath but linear from the chat-surface view. |
| **Slug** | Kebab-case, lowercase, punctuation-stripped, ≤50 chars folder name. Pre-name: `<YYYY-MM-DD>-<slug-from-first-message>`. Post-name: `<slug-of-chosen-name>`. Collision: append `-2`, `-3`. |
| **Brief** | `<project>/brief.json` schema-validated Artifact data. What the Guide saves through the Brief artifact tool when Scoping concludes. |
| **Recap greeting** | Synthetic-prompted assistant turn fired on resume when *(elapsed since last entry > 30 min) AND (no in-flight turn)*. Operationalizes the persona's "last time we were working on..." promise. |
| **Hydration** | On app launch, sidecar reads the project's session JSONL, translates message entries into `text_delta` / `text_done` sequences, and emits them so the existing chat surface rerenders without protocol changes. |
| **Project metadata** | `<project>/project.json`: `{id, name, createdAt, lastOpenedAt}`. Owns the display name; pi's `appendSessionInfo` stays unused in v0. |

## Verified pi APIs (will use)

Confirmed against `@mariozechner/pi-coding-agent` typings in `sidecar/node_modules/.../session-manager.d.ts`:

- `SessionManager.create(cwd, sessionDir?)` — fresh session, persists to JSONL. We pass `path.join(projectDir, "sessions")` as `sessionDir` to keep sessions inside the project folder rather than pi's default `~/.pi/agent/sessions/<encoded-cwd>/`.
- `SessionManager.continueRecent(cwd, sessionDir?)` — resume the most recent session in that dir. Used on every project open.
- `findMostRecentSession(sessionDir)` — for the "is there a session at all?" check before deciding create vs continue.
- `getEntries()` — for hydration replay on app launch.
- `appendCompaction()` and `CompactionEntry` — exist; pi handles automatic compaction internally. We leave defaults alone for v0+1 but will not be surprised when summaries appear in the JSONL or affect what the model sees.
- Tree state (`parentId`, `getTree`, branching) — exists in pi; UI exposure deferred. Branching ≠ multi-session; do not conflate.

## Verified Tauri concerns

- `~/.guide/` is the literal home directory + `.guide`, not Tauri's app-data convention. Mike's explicit choice for findability and parallel with `~/.pi/`. Sidecar resolves it via Node/Bun `os.homedir()`; no Tauri API needed.
- Persona path: in dev (`bun tauri dev`), the existing `<repo>/prompts/persona.md` continues to work since the sidecar already accepts an `init.personaPath`. Packaging-time bundling (Tauri resource dir → absolute path passed by Rust) is deferred per the v0 PRD's packaging exclusion.

## Locked-in scope decisions

| Decision | Choice |
|---|---|
| Persistence | Yes |
| Multi-project on disk | Yes |
| Project picker UI | Deferred to a follow-up slice |
| Session count per project | One |
| Tree-state / branching UI | Deferred |
| Naming UX | Persona asks conversationally *after* the brief is written |
| Resume greeting | Auto-fire if elapsed > 30 min AND no in-flight turn; silent restore otherwise |
| Slug scheme | Date-prefix pre-name (`YYYY-MM-DD-<from-first-message>`); plain slug post-name; `-N` on collision |
| Compaction tuning | Pi defaults; no custom hooks |
| `<repo>/.workspace/` migration | Throw away (Mike is the only user; dogfood content already lives in `_meta/project-brief.md`) |
| Persona path bundling | Deferred (lands with the packaging slice) |
| Git-init per project | Deferred (lands with the implementing phase, when there is code to track) |

## Rejected paths (recorded so they don't recur)

- **Multiple sessions per project as a first-class concept.** Cut after grilling. The driver was a vague "users will want to iterate," which decomposes into: (a) iterate on a brief = continue the same session; (b) parallel exploration = pi's tree state, deferred; (c) hide old conversation = a UI concern, not a session concern; (d) phase transitions = phase markers in one thread, not separate sessions. None require multi-session storage in v0.
- **Session picker / chrome-vs-voice picker UX.** Shelved; the broader picker question is deferred to its own slice. This slice ships the on-disk shape that a future picker will read; the picker itself is not in scope here.
- **Pre-name asking for the project name.** Rejected: the wife has no name to give before scoping happens. Naming after the brief is the only moment she has enough information.
- **Naming the wife's project as a UUID.** Rejected explicitly: human-readable slugs only; UUIDs make on-disk findability painful.
- **Building user-visible context-window/memory machinery.** Pi's compaction handles working-memory bounds; the brief on disk is the durable memory. No bespoke memory layer in this slice.

## Open / not-yet-decided (for the PRD to resolve)

- **Recap greeting prompt phrasing.** Needs a concrete synthetic-system-message draft and tuning against transcripts; should not re-greet on every turn or on quick reopens.
- **First-launch empty state UX**, given the picker is deferred. Probably: no projects exist → drop directly into chat with the existing welcome text → first user message creates the project. But the exact wiring deserves a PRD-level paragraph.
- **What survives if the JSONL is partially corrupt.** Pi's behavior under malformed entries needs verifying before we assume "it just works."
