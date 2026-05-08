# PRD — Slice 09: Open any directory as a Cairn project

## Problem Statement

Cairn today owns its projects. Every project is a folder Cairn carved out under `~/.cairn/projects/<slug>/`, named after the user's first sentence. The wife never sees the path; she just gets a project. That worked when she was the only user and the only thing she'd do with a project was talk to Cairn about it.

It stops working as soon as Cairn produces something a developer wants to take *somewhere else*. A repo that exists outside `~/.cairn/`. A folder that's already a git working tree. A project a teammate has cloned and wants to open with Cairn. The current model has no answer for any of these — the user can't point Cairn at a directory they already own, because "the project directory" is a Cairn-internal concept fused to a Cairn-internal slug.

The mismatch is everywhere a real desktop dev tool lives: Claude Code, Cursor, VS Code all open *the directory you're in*. You `cd ~/code/my-app && <tool>`, or you launch the app and it asks which folder. The directory IS the project. Cairn pretends to be that kind of app, but isn't. As long as projects only exist under `~/.cairn/projects/`, Cairn cannot be the thing a developer reaches for when they want to scope work for a repo they already have.

## Solution

Cairn becomes a directory-rooted app. You point it at any directory on your machine and that directory IS the project. Open it from a folder picker, from a recents list, or by launching Cairn from the terminal in that directory — same outcome.

The Cairn-owned per-project state — sessions, brief, plans, PRDs, issues, tasks, project context — lives in a `.cairn/` subdirectory inside the project, written there on first use, gitignored by default. The user's actual repo contents stay theirs. Two ideas going at once means two directories on disk, in whatever locations make sense for the user (one in `~/code/`, one wherever).

App-global state — the recents list, settings, API key — stays in `~/.cairn/` but no longer holds projects. Existing projects under `~/.cairn/projects/<slug>/` keep working: their internal layout is migrated in place to the new `.cairn/` shape on first open, and they appear in the recents list at their existing paths. The user can `mv` them later if they want; nothing forces it.

## User Stories

1. As a developer, I want to open Cairn pointed at a directory I already have on disk, so that I can scope work for an existing repo without first cloning it into a Cairn-owned folder.
2. As a developer, I want to launch Cairn from the terminal in a project directory and have it open *that* directory, so that the tool fits the same `cd && <tool>` muscle memory I use for Cursor and Claude Code.
3. As a developer, I want Cairn to walk up from a subdirectory to find the project root, so that running `cairn` from `repo/src/components` opens `repo` and not the subdirectory.
4. As a developer, I want a recents list when Cairn launches without a directory, so that I can pick up the project I was last working on without re-typing its path.
5. As a developer, I want an "Open Folder…" affordance in the app, so that I can switch projects without going to the terminal.
6. As the wife (non-technical user), I want my existing projects to keep working after this change ships, so that I don't lose the conversation history or briefs I already built.
7. As the wife, I want the open-folder flow to be skippable on a normal launch, so that opening Cairn still drops me back into whatever I was last working on.
8. As a developer, I want all Cairn-owned per-project files contained in a single `.cairn/` directory inside the project, so that I can see at a glance what Cairn writes and what's mine.
9. As a developer, I want `.cairn/` gitignored by default — including via a `.cairn/.gitignore` Cairn writes itself — so that I don't have to remember to add it to my own `.gitignore` and don't accidentally commit conversation history.
10. As a developer, I want my project's identity to be its absolute path, not a Cairn slug, so that renaming the directory or moving it on disk doesn't confuse Cairn about what project I'm in (the recents entry goes stale; the project itself is intact at its new location).
11. As a developer, I want the display name of a project to be independent of the directory name, so that I can keep a repo named `tcs-internal-2` and still call the project "TCS rebuild" in the Cairn UI.
12. As a developer, I want stale recents (directories I deleted or moved) to be pruned when I try to open them, not on launch, so that an unmounted external drive doesn't silently drop projects from my recents list.
13. As a developer, I want Cairn to auto-init `.cairn/` the first time I open a directory, so that there's no "initialize project" ceremony — opening a fresh directory just works.
14. As the project owner, I want Cairn to reject opening a path that doesn't exist or isn't a directory with a clear error rather than silently creating the wrong thing, so that typos don't manifest as phantom projects.
15. As the project owner, I want session JSONLs, the brief artifact, plan/PRD/issue/task artifacts, and the project context all relocated under `.cairn/` consistently, so that there is one place — and one rule — for "where Cairn writes things."
16. As the project owner, I want each new deep module (recents registry, project locator, layout adapter, legacy migrator) testable in isolation, so that the slice can land in pieces and each piece is independently verifiable.
17. As the project owner, I want the path-traversal guard in the Tauri bridge (`read_project_file`) preserved as files move under `.cairn/`, so that this refactor doesn't loosen an existing security property.

## Implementation Decisions

### Conceptual rename

The unit of identity changes from `id` (a slug that doubles as a folder name under `~/.cairn/projects/`) to `path` (the absolute directory path the user opened). `displayName` stays metadata. The `id` field is retained inside `project.json` for stable references in session entries, but no code path uses it to *locate* the project anymore — the path does that. Generating an id at create-time stays useful for naming session JSONLs and similar; it stops being a folder name.

### Storage layout

Per-project (everything Cairn writes for *this* project, inside the user's directory):

```
<project>/
  .cairn/
    .gitignore           # contains "*" so .cairn self-ignores even if the user's .gitignore doesn't list it
    project.json         # {id, name, displayName, createdAt, lastOpenedAt}
    sessions/<n>.jsonl
    brief.json|html      # whatever brief-artifact writes today
    prds/                # PRD markdowns
    issues/              # issue markdowns
    plans/               # plan artifact storage (today: implicit)
    tasks.json           # tasks artifact
    project-context.json
```

App-global (in `~/.cairn/`):

```
~/.cairn/
  recents.json           # [{path, displayName, lastOpenedAt}, ...]
  settings.json          # already exists; unchanged
```

`~/.cairn/projects/` is no longer written by new code. Legacy entries are migrated in place (see below); the directory itself becomes "old projects that happen to live there" — the user can `mv` them out, or leave them. Cairn does not delete it.

### Modules

- **CairnDir** *(new, deep)*. Encapsulates the `.cairn/` layout inside a project directory. Surface: `ensure(projectPath)` (creates `.cairn/` and writes `.gitignore` on first call; idempotent), `sessionsDir(projectPath)`, `briefPath(projectPath)`, `prdsDir(projectPath)`, `issuesDir(projectPath)`, `plansDir(projectPath)`, `tasksPath(projectPath)`, `projectContextPath(projectPath)`, `metadataPath(projectPath)`. Pure path math + file IO for `ensure`. Every place that today writes "into the project" goes through this module — there should be no joins of `project.path` with raw subpaths after this slice. This module is the single source of truth for the layout; the layout can change later without touching call sites.
- **ProjectStore** *(rewritten)*. Surface narrows: `read(projectPath)` (load + validate `.cairn/project.json`), `create(projectPath, firstMessage)` (called when opening a directory that has no `.cairn/`), `touch(projectPath)`, `rename(projectPath, displayName)`. The slug-as-folder-name code path is removed. The `id` field is generated at create-time via the existing slug generator so session-naming stays stable, but it never becomes a folder name. Returns the same `Project` shape as today (`{id, name, displayName, path, createdAt, lastOpenedAt}`) so most call sites in `cairn-tools.ts` don't change.
- **RecentsRegistry** *(new, deep)*. Manages `~/.cairn/recents.json`. Surface: `add(projectPath, displayName)` (upsert + bump `lastOpenedAt`), `list()` (sorted desc by `lastOpenedAt`), `findMostRecent()`, `remove(projectPath)` (lazy prune entry point), `validateOnAccess(projectPath)` (used by the open flow: if the path no longer exists or has no `.cairn/`, the entry is removed and the caller is told). Replaces today's `findMostRecent`-by-folder-listing in `ProjectStore`. Pure-ish (file IO only).
- **ProjectLocator** *(new, deep, pure)*. `findProjectRoot(startPath)`: walks up from `startPath` looking for the nearest ancestor with a `.cairn/` directory. Returns the directory or null. Caps at the filesystem root and the user's home directory to avoid pathological climbs. Used by the CLI entrypoint when `cairn` is run from a subdirectory.
- **LegacyMigrator** *(new, deep)*. `migrateLegacyProject(projectPath)`: idempotently moves a pre-`.cairn/` Cairn project's files into a `.cairn/` subdir. Detect by: `projectPath` is a direct child of `~/.cairn/projects/` AND `<projectPath>/project.json` exists AND `<projectPath>/.cairn/project.json` does not. Move `project.json`, `sessions/`, `brief.*`, `prds/`, `issues/`, `tasks.json`, `project-context.json` into `.cairn/`. Idempotent on re-run (the second-run detector returns false). Runs on first open of any path that matches the legacy detector.
- **Sidecar runtime** *(modified)*. `init` no longer auto-resumes "the most recent project under `~/.cairn/projects/`" by listing folders. Instead it reads `RecentsRegistry.findMostRecent()`, validates the path, and either opens it or emits an empty hydrate. New input message: `{type: "open_project", path: string}` and `{type: "list_recents"}` with corresponding output messages. The first-prompt-creates-a-project behavior is kept *only* for the legacy launch path (no recents, no path supplied) so the wife's existing flow doesn't regress; new launches with a path skip that step. `getSessionDir(project)` becomes `CairnDir.sessionsDir(project.path)`. `process.chdir(project.path)` stays — the cwd of the sidecar is the user's project root, same as today.
- **Tauri bridge** *(modified)*. New commands: `open_project_dialog()` (returns chosen path via OS folder picker), `open_project(path)` (forwards to sidecar), `list_recents()` (forwards to sidecar). CLI argument handling is added at startup: if launched with a positional path argument, that path is sent as the initial `open_project` after the sidecar emits `ready`; if launched without args, the sidecar's normal `init` flow runs (which now consults the recents registry). The `read_project_file` path-traversal guard is preserved; the file lookup base shifts from `project.path` to `CairnDir.prdsDir(...)`-style resolved paths, so the guard wraps `.cairn/<subpath>` instead of `<subpath>`.
- **Frontend** *(touched)*. New "no active project" state shows: the recents list (clickable rows), an "Open Folder…" button (calls `open_project_dialog`), and the existing empty chat affordance for first-prompt-creates-project (legacy launch path). When a project is active the UI is unchanged. The `useSidecarSession` hook gains handlers for the new sidecar event types and a new action to open by path or via dialog.

### Sidecar protocol additions

Inputs (sidecar accepts):
- `{type: "open_project", path: string}` — switch the active project to the directory at `path`. Migrates legacy layout if applicable, ensures `.cairn/`, opens or creates `project.json`, hydrates session.
- `{type: "list_recents"}` — request the recents list.

Outputs (sidecar emits):
- `{type: "recents", entries: [{path, displayName, lastOpenedAt}]}` — emitted in response to `list_recents` and on every successful `open_project`.

The existing `active_project` event keeps its shape; the `path` field is now the user's directory rather than `~/.cairn/projects/<slug>/`. Existing events (`hydrate`, `ready`, `text_delta`, `text_done`, `agent_end`, `error`, `creating_started`) are unchanged.

### Auto-init behavior

Opening a path that has no `.cairn/` triggers `CairnDir.ensure` *before* any user prompt — i.e., immediately on `open_project`. This writes `.cairn/.gitignore` and creates the empty subdirectory. `project.json` is *not* written at this point. The first user prompt creates the metadata via `ProjectStore.create(projectPath, firstMessage)` exactly like today. This keeps the "first message names the project" UX intact while moving the on-disk container.

The `.gitignore` written into `.cairn/` contains a single line: `*`. This causes git to ignore everything inside `.cairn/` regardless of whether the user's repo-level `.gitignore` mentions `.cairn/`, and regardless of whether the repo is even a git repo at the time of init.

### Migration behavior

On `open_project`, before doing anything else: if the path matches the legacy detector, run `LegacyMigrator.migrateLegacyProject(path)`. This moves the project's contents into a `.cairn/` subdir inside the same folder. Sessions, brief, PRDs, issues, tasks, project-context, project.json — all relocated. The folder name on disk doesn't change.

Existing projects are surfaced in the recents list one of two ways:
- On first launch under the new code, scan `~/.cairn/projects/` once and add every folder containing `project.json` (legacy or migrated) to the recents registry. This is a one-shot bootstrap; subsequent launches read recents from the registry, not by scanning `~/.cairn/projects/`.
- The bootstrap is idempotent: re-running it doesn't duplicate entries (upsert by path).

The recents bootstrap is independent of the per-project layout migration. A legacy project shows up in recents with its current path; layout migration happens when the user actually opens it.

### CLI entrypoint

In dev (`bun tauri dev`), the Tauri binary is launched from the repo root; positional args are forwarded by the dev runner and parsed by the bridge.

In production, the packaged Tauri app receives args via the OS. A user-installed shell shim that does `exec /Applications/Cairn.app/Contents/MacOS/cairn-bin "$@"` lets the user type `cairn` in their terminal. **The shim install is out of scope for this slice** (it's a separate, smaller piece of work — UI button + a known install location). What this slice ships is: the app correctly handles a positional path argument when given one. Users can hand-write a shim in the meantime.

When launched with a path argument, the bridge resolves it to an absolute path, asks the locator to walk up if needed (so `cairn .` from a subdirectory finds the project root), and sends `open_project` once the sidecar is ready. When launched without args, the bridge sends `init` and lets the sidecar decide via recents.

### Defaults / paths

- `.cairn/` subdirectory name is fixed (no env override). Aligns with `.git/`, `.cursor/`, etc.
- Recents registry capacity: unbounded for now. If it grows large enough to matter, that's a future trim.
- Walk-up cap: stops at the filesystem root and at the user's home directory, whichever comes first. The walk should not climb past `$HOME` to avoid finding a `.cairn/` belonging to a different project tree.
- `~/.cairn/recents.json` is read on every `init`; it's small enough that no caching is needed.

## Testing Decisions

A good test for this slice asserts behavior the user can name — *"opening a directory creates `.cairn/` inside it,"* *"opening a path I've opened before brings my conversation back,"* *"a project I had under `~/.cairn/projects/` keeps working,"* *"running cairn from a subdirectory opens the project root"* — not pi internals or file-system shape beyond what the user would notice.

- **CairnDir, unit (`bun test`).** `ensure(path)` creates `.cairn/` and writes `.cairn/.gitignore` with `*`; idempotent on re-run. Path helpers return the expected sub-paths. Uses a temp directory.
- **ProjectStore, unit (`bun test`).** Replaces today's slug-folder tests. `create(path, firstMessage)` writes `.cairn/project.json` with stable id and clean displayName. `read(path)` round-trips. `rename(path, name)` updates display name only. `touch(path)` updates `lastOpenedAt`. The legacy folder-collision tests are removed; the new model has no folder-collision logic to test.
- **RecentsRegistry, unit (`bun test`).** `add` upsert semantics; `list` ordering by `lastOpenedAt` descending; `remove` for lazy prune; `findMostRecent` returns null on empty. Tabular over a temp registry file.
- **ProjectLocator, unit (`bun test`).** Tabular: walk-up from various depths, with and without `.cairn/` ancestors, capped at home directory. Pure path logic, no file IO beyond a fixture tree in a temp dir.
- **LegacyMigrator, unit (`bun test`).** Set up a temp dir mimicking `~/.cairn/projects/<slug>/` with `project.json`, `sessions/`, `brief.json`, `prds/`, `issues/` at the root. Run `migrateLegacyProject`. Assert all those files are now under `.cairn/` and the original locations are empty. Re-run; assert no-op (idempotent). Negative case: a path that isn't a legacy project is left untouched.
- **Sidecar protocol smoke, integration (`bun test`).** Extends today's protocol test. Spawn the sidecar with a temp HOME so `~/.cairn/recents.json` is sandboxed. Send `open_project` for a fresh temp directory; assert `.cairn/` is created with `.gitignore`, an `active_project` event fires with the temp path, and a subsequent `prompt` writes a session JSONL inside `.cairn/sessions/`. Restart the sidecar against the same HOME; assert `init` resumes that path via recents and emits `hydrate` with the prior message. Then run `open_project` against a *legacy*-shaped temp directory and assert the migrator moved its contents into `.cairn/` before the session opened.
- **Path-traversal guard, regression (`bun test` or Rust `cargo test`).** Verify that `read_project_file` still rejects `..` segments after the base shifts to `.cairn/`-rooted lookups. The existing test from the bridge tests file is the model; one new case asserts the guard catches `../../etc/passwd` against the new base.
- **End-to-end smoke, manual.** (a) Launch Cairn fresh on a clean `~/.cairn/`; verify the recents list bootstraps from any pre-existing `~/.cairn/projects/` entries. (b) Click "Open Folder…" and pick a directory that's never been opened; verify `.cairn/` appears inside it with `.gitignore`. (c) Type a prompt; verify `.cairn/sessions/` and `.cairn/project.json` are written. (d) Quit, relaunch; verify the directory is the most-recent and is auto-resumed. (e) `git init` the directory and `git status`; verify `.cairn/` does not appear. (f) Open one of the wife's existing legacy projects; verify the layout is migrated and the conversation resumes. (g) Re-open the same legacy project; verify no double-migration (idempotent).

We deliberately do not write:
- **CLI shim install logic** — out of scope; the shim lands in a follow-up slice.
- **Frontend Playwright tests for the recents UI** — the project doesn't have Playwright today; manual smoke covers it.
- **Tests asserting performance of the recents read** — `recents.json` is small in any realistic horizon.
- **Tests for arbitrary `.gitignore` content** — Cairn writes a fixed string (`*\n`); the existence-and-content test in the CairnDir unit is sufficient.

Prior art: the existing protocol test is in `sidecar/tests/protocol.test.ts`; the existing project-store test in `sidecar/tests/project-store.test.ts` shows the temp-directory + `bun test` pattern. New unit tests follow the same shape.

## Out of Scope

- **`cairn` shell shim install ("Install command in PATH" UI).** Lands in a follow-up slice; this slice ships path-aware launch but expects the user to wire `cairn` in PATH manually if they want it.
- **Path-keyed global storage (workspace storage).** The "bucket #2" from the design conversation: per-project state too large for the project dir, stored under `~/.cairn/` and keyed by path. Not needed yet — current per-project artifacts are small.
- **Project-level vs. user-level memory and agents.** Confirmed deferred. No `~/.cairn/agents/`, no project `.cairn/CAIRN.md`. Add when the need is concrete.
- **Forced relocation of legacy projects to a new on-disk location.** Layout *inside* legacy projects is migrated; the projects themselves stay at `~/.cairn/projects/<slug>/`. Users can `mv` them later.
- **A "Relocate project to…" UI action.** Future slice; today the user does it with `mv` and re-opens.
- **A "_meta/" tier for committed PRDs/issues separate from `.cairn/`.** This repo's `_meta/prds/` is a pre-existing convention that predates this slice; it is *not* something Cairn writes for user projects. Whether and how Cairn should support team-shared committed artifacts is a future decision.
- **Shared project state across machines (cloud, sync).** Not in scope.
- **Multi-window or tab support.** One window, one project, same as today.
- **A "delete project from recents only" vs. "delete project from disk" affordance.** This slice ships lazy prune (open-and-fail removes the entry); explicit affordances are deferred.

## Further Notes

- **Build order.** Land the deep modules first with their unit tests, then wire them: CairnDir → RecentsRegistry → ProjectLocator → LegacyMigrator → ProjectStore rewrite → sidecar runtime changes → Tauri bridge commands and CLI arg handling → frontend recents UI. Each step keeps the app functional. The runtime change is the largest single landing; everything before it is mechanical and testable in isolation.
- **The `id`-as-folder-name removal is a one-way door.** Once code stops listing `~/.cairn/projects/` to find projects, the recents registry is the only index. The bootstrap step (one-shot scan on first launch under the new code) is the safety net for migration. If it fails or is skipped, legacy projects are still reachable via Open Folder, just not in recents.
- **Risk: `process.chdir` and CWD-sensitive code.** The sidecar already does `process.chdir(project.path)` (today line 815). After this slice, that path is the user's working tree, which means any tool — pi's filesystem tools, anything Cairn or its skills shells out — operates with the user's directory as cwd. Verify this doesn't surface unexpected behavior (e.g., a pi tool reading `./package.json` and finding the user's, not Cairn's). Most likely fine but worth one careful pass during implementation.
- **Risk: path normalization across OSes.** macOS-only today. Be precise about `path.resolve` vs raw strings before storing in `recents.json`; store fully-resolved absolute paths so equality checks work. A path stored as `/Users/me/code/foo` and re-encountered as `/Users/me/code/foo/` should hit the same entry.
- **Risk: opening a directory that's also the Cairn repo itself.** If a developer opens Cairn while pointed at the Cairn source tree, `.cairn/` will be created at the repo root. The `.cairn/.gitignore` keeps it out of version control. Worth a manual smoke; if it surfaces issues, treat the Cairn repo as a special case via convention, not code.
- **`.cairn/.gitignore` precedence.** A directory's own `.gitignore` with `*` reliably ignores its contents; this is the standard pattern (`node_modules/.gitignore` in many setups). Verified mental model, but the manual smoke covers it.
- **What `.cairn/` is *not*.** Not a config-share mechanism between teammates. Not a place users edit by hand. Not part of the project's source tree. It is a scratch space Cairn owns. If a future slice wants team-shared state (committed prompts, shared agents), that goes somewhere else (the `_meta/` convention, or explicit per-file opt-in), not by un-ignoring parts of `.cairn/`.
