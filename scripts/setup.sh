#!/usr/bin/env bash
# Bootstrap a fresh checkout for `bun tauri dev`.
#
# Installs (with confirmation) the tools Cairn needs that aren't on a stock
# Mac: Xcode Command Line Tools, Bun, Rust. Then runs `bun install` at the
# repo root and inside `sidecar/`. macOS only for now.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup.sh currently supports macOS only." >&2
  exit 1
fi

confirm() {
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

INSTALLED_TOOLS=()

# 1. Xcode Command Line Tools — clang and codesign for Rust/Tauri.
if ! xcode-select -p >/dev/null 2>&1; then
  echo "==> Xcode Command Line Tools missing."
  echo "    A macOS installer dialog will open. Click 'Install' and wait for"
  echo "    it to finish (a few minutes), then re-run this script."
  xcode-select --install || true
  exit 1
fi
echo "==> Xcode Command Line Tools: present."

# 2. Bun.
if ! command -v bun >/dev/null 2>&1; then
  echo "==> Bun missing."
  if confirm "    Install Bun via the official curl|bash installer (https://bun.sh)?"; then
    curl -fsSL https://bun.sh/install | bash
    # Installer adds bun to PATH via shell rc; make it visible to this script too.
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    INSTALLED_TOOLS+=("Bun")
  else
    echo "    Skipped. Install Bun manually and re-run." >&2
    exit 1
  fi
fi
echo "==> Bun: $(bun --version)"

# 3. Rust via rustup.
if ! command -v cargo >/dev/null 2>&1; then
  echo "==> Rust missing."
  if confirm "    Install Rust via rustup (https://rustup.rs)?"; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
    INSTALLED_TOOLS+=("Rust")
  else
    echo "    Skipped. Install Rust manually and re-run." >&2
    exit 1
  fi
fi
echo "==> Rust: $(cargo --version)"

# 4. Frontend deps.
echo "==> bun install (root)"
bun install

# 5. Sidecar deps.
echo "==> bun install (sidecar)"
(cd sidecar && bun install)

echo
echo "Setup complete."
echo

if (( ${#INSTALLED_TOOLS[@]} > 0 )); then
  echo "Heads up: this run installed ${INSTALLED_TOOLS[*]}, which updated your"
  echo "shell config (e.g. ~/.zshrc). This terminal window won't see the new"
  echo "tools yet. Open a new terminal, cd back into this directory, then run:"
else
  echo "Start the app in dev mode:"
fi
echo
echo "    bun tauri dev"
echo
echo "The first launch opens a settings dialog asking for your Anthropic API"
echo "key. Paste it there; Cairn stores it locally and won't ask again."
