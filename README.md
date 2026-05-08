# Cairn

A native (Tauri 2) app that helps non-technical people build small, useful software by walking them through a workflow they don't know exists: scope what you want, slice it into a first chunk, build that chunk, repeat.

The user talks to a single voice — the **Cairn** — that owns every technical decision. Headless **sub-agents** do the actual coding underneath, on a [pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) harness. The user never sees code, diffs, errors, or terminal output.

For full domain language, see [`CONTEXT.md`](./CONTEXT.md). For the v0 scope, see [`_meta/project-brief.md`](./_meta/project-brief.md).

## Quickstart

Fastest path from a fresh Mac to a running app. **macOS only** for now.

1. **Open Terminal.** Press `Cmd+Space`, type `Terminal`, press Enter.
2. **Get the code.** Paste this and press Enter:
   ```sh
   git clone https://github.com/msmedes/cairn.git && cd cairn
   ```
   The first time you run `git`, macOS may prompt you to install the Xcode Command Line Tools — click **Install** and wait a few minutes, then re-run the command.
3. **Run setup.** This checks for Bun, Rust, and Tauri's prerequisites and offers to install anything missing:
   ```sh
   ./scripts/setup.sh
   ```
   If the script installed Bun or Rust, your current terminal can't see them yet. Either paste the `export` lines the script prints at the end, or close this window and open a new one (then `cd cairn` again).
4. **Get an Anthropic API key.** Sign in at [console.anthropic.com](https://console.anthropic.com/), go to **API Keys → Create Key**, and copy the value (it starts with `sk-ant-`).
5. **Start the app:**
   ```sh
   bun tauri dev
   ```
   On first launch a settings dialog opens — paste your API key there. Cairn stores it locally and won't ask again.

That's the whole loop. The sections below cover architecture, build output, and dev scripts in more detail.

## Status

v0 — proves the **scoping** experience works for a non-technical user. Slicing and implementing land in v1. See `_meta/project-brief.md` for the full non-goals list.

## Architecture

Three processes, talking over stdio:

- **Frontend** (`src/`) — React 19 + Vite. Renders the chat panel and the user-visible artifact tabs (Project / Plan / Tasks).
- **Tauri shell** (`src-tauri/`) — Rust host. Spawns the sidecar binary, brokers IPC, owns the window.
- **Sidecar** (`sidecar/`) — Bun process. Runs pi-coding-agent, manages the Project/Session, persists artifacts, and streams events back to the frontend as LF-delimited JSON.

The persona and skill prompts live in `prompts/` and are bundled into the app at build time. Engineering scaffolding (ADRs, PRDs, issues, brief) lives in `_meta/`.

## Requirements

- **Bun** ≥ 1.1 — runtime + package manager + sidecar compiler.
- **Rust** stable toolchain — required by Tauri. Install via [rustup](https://rustup.rs/).
- **Tauri system deps** for your OS — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/). On macOS, Xcode Command Line Tools are enough.
- **An Anthropic API key** — pi-coding-agent uses Claude under the hood.

## Setup

On a fresh Mac (no Bun, no Rust, no Xcode tools), run:

```sh
./scripts/setup.sh
```

The script checks for each prerequisite and offers to install anything missing (Xcode Command Line Tools, Bun, Rust via rustup), then runs `bun install` at the root and inside `sidecar/`. macOS only.

If you already have the toolchain, `bun install && (cd sidecar && bun install)` is enough.

You can supply your Anthropic API key either through the in-app settings dialog (it opens on first launch) or by creating `.env.local` at the repo root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env.local` is gitignored. The sidecar reads it on startup (see `sidecar/env.ts`).

## Run

Dev mode (hot reload, devtools, no bundling):

```sh
bun tauri dev
```

This starts Vite on `localhost:1420`, builds the sidecar in-tree, and opens the Tauri window.

## Build

Produce a packaged `Cairn.app` and a plain `.dmg`:

```sh
bun run build:app
```

The script (`scripts/build-app.sh`) compiles the sidecar into a single executable named for the Rust target triple Tauri expects, runs `tauri build`, then creates a `.dmg` with `hdiutil` (skipping Tauri's AppleScript-driven dmg layout). Output lands in `src-tauri/target/release/bundle/`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Vite dev server only (no Tauri window). |
| `bun tauri dev` | Full dev app — frontend + Rust shell + sidecar. |
| `bun run build` | Type-check frontend and produce a Vite production bundle. |
| `bun run build:app` | Build a packaged `.app` and `.dmg`. |
| `bun run lint` / `bun run lint:fix` | Biome check / autofix. |
| `bun run typecheck` | `tsc --noEmit` for both frontend and sidecar. |
| `bun run test` | Frontend (Vitest) + sidecar (`bun test`). |
| `bun run test:frontend` | Vitest only. |
| `bun run test:sidecar` | Sidecar tests only. |

## Layout

```
src/             React frontend
src-tauri/       Rust shell (Tauri 2)
sidecar/         Bun stdio process — runs pi-coding-agent
prompts/         Persona + skill prompts bundled into the app
scripts/         Build helpers
_meta/           ADRs, PRDs, issues, project brief (engineering scaffolding)
```

Per-user runtime state (the user's actual Projects) lives outside the repo at `~/.cairn/projects/`.

## License

Unlicensed — learning project, not a product.
