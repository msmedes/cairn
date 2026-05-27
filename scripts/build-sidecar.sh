#!/usr/bin/env bash
# Compile the Bun sidecar executable using the Rust target triple Tauri expects.

set -euo pipefail

cd "$(dirname "$0")/.."

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) BUN_TARGET=bun-darwin-arm64; RUST_TARGET=aarch64-apple-darwin ;;
  Darwin-x86_64) BUN_TARGET=bun-darwin-x64; RUST_TARGET=x86_64-apple-darwin ;;
  Linux-x86_64) BUN_TARGET=bun-linux-x64; RUST_TARGET=x86_64-unknown-linux-gnu ;;
  *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

SIDECAR_OUT="src-tauri/binaries/cairn-sidecar-${RUST_TARGET}"

echo "==> compiling sidecar -> ${SIDECAR_OUT}"
mkdir -p src-tauri/binaries
bun build --compile \
  --target="${BUN_TARGET}" \
  ./sidecar/index.ts \
  --outfile "${SIDECAR_OUT}"
