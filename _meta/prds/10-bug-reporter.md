# PRD — Slice 10: Bug reporter

## Problem Statement

When something goes wrong inside Cairn — a chat that hangs mid-stream, an artifact that renders the wrong thing, a sub-agent that loops, a recap that doesn't arrive — the person sitting in front of the app has no way to tell the developer about it that doesn't lose almost all of the context. Right now they would have to: notice the bug, switch to a browser, go to GitHub, write a description from memory, and hope the developer can guess at what was on screen and what the sub-agent was doing five seconds before it broke. The richest signal — the actual session transcript and the in-memory log of sub-agent activity — sits on disk inside `<project>/.cairn/` and inside the Rust process's dev-event ring buffer respectively, and the user has no idea it exists.

The cost of that gap is felt every time the developer triages an issue with no transcript: the bug either gets dismissed as unreproducible or eats half a day to reconstruct. While the user base is the developer plus a handful of dogfooders, this is also the cheapest moment to fix it — there is no end-user privacy story to settle, no third-party intake to stand up, no auth to wire. A button that bundles the relevant Cairn-owned state into a zip, opens a prefilled GitHub issue, and reveals the zip in Finder so the user can drag it into the GitHub textbox is enough to close the gap completely for the audience that actually exists today.

## Solution

The chat header gets a small "Report a bug" affordance. Clicking it opens a modal asking for a one-line title and a free-text description of what went wrong. Submitting the modal does three things from the user's point of view, in fast succession: a GitHub "New issue" page opens in the default browser already filled in with their title and description and tagged `bug`; a Finder window pops up with a freshly-built `cairn-bug-<timestamp>.zip` selected; and the modal closes. The user drags the zip from Finder into the GitHub issue textbox, GitHub uploads it as an attachment, and the user clicks Submit on the GitHub page. That's the flow.

Inside the zip, the developer finds: a copy of the user's `<project>/.cairn/` directory at the moment the bug was reported (sessions, brief, plan, tasks, prds, issues, project context, project metadata — everything Cairn writes for the project), a `dev-events.json` snapshot of the sub-agent activity ring buffer the Tauri shell holds in memory, and a `meta.json` with the timestamp, app version, OS, active project name, the user's title, and the user's description. The user does not see the zip's contents at any point — Cairn just stages it and hands it off to the OS.

The button is always visible. While the only people clicking it are dogfooders who already understand sub-agent terminology, that's fine; before real end users land we will revisit redaction in a follow-up slice.

## User Stories

1. As a dogfooder, I want a "Report a bug" button always visible in the chat header, so that I can file something the moment a bug happens without hunting through menus.
2. As a dogfooder, I want a small modal that asks for a title and a description, so that I can give the developer enough context to triage without writing a novel.
3. As a dogfooder, I want submitting the modal to open a GitHub "New issue" page with my title and description already filled in, so that I never have to retype what I just wrote.
4. As a dogfooder, I want the GitHub issue to be auto-tagged `bug`, so that the developer's issue list is sorted without my doing anything.
5. As a dogfooder, I want a zip of the relevant Cairn state to be ready in Finder by the time I get to the GitHub tab, so that attaching it is a single drag-drop with no file-hunting.
6. As a dogfooder, I want the zip filename to include a timestamp, so that if I report several bugs in a session I can tell the attachments apart.
7. As a dogfooder, I want the modal to close as soon as I submit, so that I am not blocked from continuing the conversation while the GitHub tab is open in the background.
8. As the developer triaging the issue, I want the zip to contain the user's full `<project>/.cairn/` directory, so that I can see the session transcript, brief, plan, tasks, PRDs, and issues exactly as they were when the bug was reported.
9. As the developer triaging the issue, I want a `dev-events.json` snapshot of the in-memory sub-agent activity log included in the zip, so that I can see what the sub-agents were doing in the seconds before the bug, which is not on disk anywhere else.
10. As the developer triaging the issue, I want a `meta.json` with timestamp, app version, OS, active project name, and the user's submitted title and description included in the zip, so that I have everything I need to identify the build and reproduce conditions in one file.
11. As a dogfooder reporting a bug before I've opened any project, I want the button to still work, so that I can report startup or empty-state bugs that occur before there is any project to zip.
12. As a dogfooder, I want a screenshot to be optional and handled by the OS rather than by Cairn, so that I am not forced through a custom capture flow when macOS already has Cmd+Ctrl+Shift+4 and GitHub already auto-uploads pasted images.
13. As a dogfooder, I want the modal to surface a clear error if the bundler fails (zip command exits non-zero, temp dir not writable, etc.), so that I know to retry rather than wonder whether GitHub got the report.
14. As the developer maintaining this code, I want the URL builder to be a pure function with no Tauri dependency, so that I can unit-test it in vitest without spinning up the Rust shell.
15. As the developer maintaining this code, I want the bundler to be a single Tauri command that owns staging, zipping, revealing, and URL-opening end-to-end, so that the frontend has a single invoke call to make and a single error path to handle.
16. As the developer maintaining this code, I want sub-agent activity to land in the zip alongside the chat transcript, so that this build of the bug reporter genuinely captures what dogfooders need without pretending to enforce a redaction policy that does not yet exist.

## Implementation Decisions

### `bugReportUrl` — pure URL builder (frontend)

A pure module that takes the user's title, description, the active project's display name (or `null`), and the app version, and returns the prefilled GitHub "New issue" URL. The URL points at `https://github.com/msmedes/cairn/issues/new`, and uses query parameters `title`, `body`, and `labels=bug`. The body is a short markdown template — not the transcript itself, since the transcript travels in the zip — that includes the user's free-text description, a system-info block (app version, OS, active project name, timestamp), and a one-line instruction telling the user to drag the zip from Finder into the textbox. All values are URL-encoded with `encodeURIComponent`. No truncation logic is needed because the body is bounded by the template plus the user's typed description; transcripts and dev events are not in the URL.

### `bugReportBundler` — Tauri command (Rust)

A single `#[tauri::command]` invocation that the dialog calls with `{ projectPath: Option<String>, devEventsJson: String, metaJson: String, githubUrl: String }`. The command:

1. Mints a timestamped bundle name of the form `cairn-bug-<unix-seconds>`.
2. Creates a staging directory at `std::env::temp_dir().join(<bundle-name>)`.
3. If a project path is provided and a `.cairn/` exists under it, recursively copies that subtree into `<staging>/cairn/`. The directory is renamed from `.cairn` to `cairn` inside the bundle so that `unzip` tools and macOS Finder do not hide it as a dotfile. If no project path is provided or no `.cairn/` exists, this step is skipped — the bundle still produces a useful artifact for early-startup bugs.
4. Writes the provided `dev-events.json` and `meta.json` strings into the staging directory verbatim.
5. Shells out to `/usr/bin/zip -rq <bundle>.zip <bundle>` from the temp dir to produce `<bundle>.zip` next to the staging dir. macOS-only is acceptable because Cairn itself is macOS-only today.
6. Removes the staging directory once the zip is in place; the zip is the only artifact retained.
7. Calls `OpenerExt::open_url` on the GitHub URL and `OpenerExt::reveal_item_in_dir` on the zip path. These are invoked directly through the plugin's Rust API rather than from JS, so they bypass the JS-facing capability allowlist; no change to `capabilities/default.json` is required.
8. Returns the zip path as a string on success, or a structured error string on failure.

The command does not depend on the sidecar — it does not lock `SidecarState` or coordinate with the bun process. It is a self-contained shell-out plus a couple of fs operations plus two opener calls.

### `BugReportDialog` — React component

A controlled modal with `title` and `description` fields and a submit button. On submit it gathers the in-memory `messages` and `devEvents` from props, builds a `meta.json` payload (timestamp, app version via `getVersion()` from `@tauri-apps/api/app`, `navigator.userAgent` for OS, active project name, user title, user description) and a `dev-events.json` payload (the dev event entries serialized as a JSON array), constructs the GitHub URL via `bugReportUrl`, and invokes the Tauri command with all four. While the invoke is in flight the submit button is disabled and a "preparing…" status is shown; on success the modal closes; on failure the error string is rendered inline so the user can retry.

The component does not subscribe to sidecar state directly — `messages` and `devEvents` are passed in by `App.tsx` so that the snapshot is captured at modal-open time and not at submit time. (Capturing at modal-open avoids a subtle race where new sub-agent events arrive while the user is typing and shift what's in the bundle.)

### `App.tsx` chrome wiring

A "Report a bug" button is added to the `header-actions` div in the chat header, alongside the API key, dev mode, and status pills. Clicking it sets a piece of local state that opens `BugReportDialog`. The dialog receives `messages` from `useSidecarSession`, `devEvents` from `useSidecarDevLog`, the active project (path + display name) from the same hook, and the app version (resolved once at App mount). On dialog close the state flips back.

### Cargo and capability changes

No new Cargo crate is required — the bundler uses only `std::fs`, `std::process::Command`, `std::env::temp_dir`, and the already-present `tauri_plugin_opener::OpenerExt`. The capability file does not need modification because the Rust command itself, not the JS layer, calls `open_url` and `reveal_item_in_dir`; the JS surface is one Tauri command we register ourselves.

### GitHub destination

Hard-coded to `msmedes/cairn`. Not configurable in this slice. If the repo moves, the URL constant is the only place to update.

### Audience and redaction

The button is always visible. Sub-agent activity will land in the zip without any user-facing redaction. This is the deliberate v0 trade-off: the only people clicking it are dogfooders, all of whom already know sub-agents exist. A redaction toggle is in scope for a later slice, before any non-technical end user is given this build.

## Testing Decisions

A good test for this slice exercises external behavior: the URL builder produces the right URL for the right inputs; the Rust bundler produces a zip with the right contents in the right layout for a representative project tree; the dialog component takes a title + description and ends up calling the bundler with the expected payload shape. Implementation details — the exact temp-dir path, the exact line of zip output, internal helper signatures — are not asserted on.

**`bugReportUrl`** — vitest unit tests modeled after the existing `briefArtifact.test.ts` and `planArtifact.test.ts` patterns. Cases: a fully-populated input produces a URL with `title=`, `body=`, and `labels=bug`; special characters (newlines, spaces, ampersands, unicode) round-trip through `decodeURIComponent` correctly; a missing project name falls back to a sensible placeholder rather than emitting `null` into the body.

**`bugReportBundler`** — Rust integration tests in `src-tauri/src/lib.rs` (or a sibling `tests/` module if the existing file is already large), modeled after the existing `startup_project_path_*` tests at the bottom of `lib.rs`. Cases: given a temp project directory containing `.cairn/sessions/0.jsonl` and `.cairn/project.json`, the produced zip extracts to a directory containing `cairn/sessions/0.jsonl`, `cairn/project.json`, `dev-events.json`, and `meta.json`; given no project path, the produced zip contains only `dev-events.json` and `meta.json`; given a project path that exists but has no `.cairn/` subdirectory, the same. The test does not exercise `open_url` or `reveal_item_in_dir` — those are side-effecting OS handoffs that are not meaningful to assert on in a test runner. The test directly invokes the bundler's core function (extracted so it does not require `AppHandle`) and asserts on the zip's contents.

**`BugReportDialog`** — vitest + Testing Library, modeled after `PanelTabs.test.tsx`. One render-and-submit test: filling title and description, clicking submit, asserts the mocked `invoke` was called with a payload containing the expected `githubUrl`, `projectPath`, `devEventsJson`, and `metaJson` fields. Error-path render is asserted by injecting a rejected mock and looking for the error message in the DOM.

**Deliberately not tested:** the `OpenerExt` calls (OS handoff), `App.tsx`'s wiring of the dialog (covered by the dialog test plus manual smoke), and CSS. Manual smoke for this slice: file a real bug against the cairn repo, confirm the issue page opens prefilled and Finder reveals the zip, confirm the zip contents match expectations.

## Out of Scope

- **Native screenshot capture inside Cairn.** macOS Cmd+Ctrl+Shift+4 puts a region screenshot on the clipboard, and GitHub's issue textbox auto-uploads pasted images. Building a Tauri-side capture path adds an OS shell-out and a temp-file flow for something the OS already handles cleanly. Revisit only if dogfooders find the OS shortcut friction-y.
- **Authenticated GitHub submission via API or `gh` CLI.** Would let us upload the zip directly without the drag-drop step, at the cost of secret management or a `gh` install dependency. Not worth the complexity while the prefilled-URL flow is sufficient.
- **Redaction toggle that strips sub-agent activity for end users.** Belongs in the slice that introduces the first non-dogfooder build path. Until then, the always-visible-with-internals trade-off is deliberate.
- **Non-GitHub destinations (email, Formspree, webhook).** The GitHub-account requirement is a real ceiling for non-technical end users, but it is not a ceiling for the audience that exists today. Add an alternate destination when the audience changes.
- **Configurable destination repo.** Hard-coded to `msmedes/cairn`. Would only matter if Cairn became a library others used to ship apps; it is not yet.
- **Rate-limiting or deduplication of bug reports.** A user spamming the button just gets multiple zips in temp; not a real problem yet.
- **Auto-cleanup of old `cairn-bug-*.zip` files in temp.** The OS handles `/tmp` GC. Not worth a custom janitor.

## Further Notes

- The recently-merged Slice 09 (`<project>/.cairn/`) is what makes the bundler clean — every file Cairn writes for a project lives under one subtree we can `cp -r`. Predates that slice and the bundler would have had to enumerate `~/.cairn/projects/<slug>/` plus separately-located artifacts.
- The "always visible" + "sub-agent activity in the zip" combination is the highest-friction trade-off in this PRD. It is intentional for now and explicitly flagged as a follow-up. If anyone non-technical opens this build, they will see internals in the GitHub issue body that contradicts Cairn's "sub-agents are invisible" product premise.
- Snapshot-on-modal-open (vs snapshot-on-submit) is a deliberate small choice: it prevents a sub-agent finishing in the background while the user is typing from changing what's in the bundle. The user's mental model is "what was happening when I clicked the button," which matches snapshot-on-open.
- Rust calling `open_url` / `reveal_item_in_dir` directly (rather than the JS layer doing so via `@tauri-apps/plugin-opener`) is a deliberate choice to skip the JS-facing capability dance. If a future slice needs to call these from JS, the capability file will need to be expanded then.
- macOS-only `/usr/bin/zip` is fine because Cairn is macOS-only. When Cairn ships a Windows or Linux build, this slice will need a small abstraction or a Rust zip crate; flag at that point, not now.
