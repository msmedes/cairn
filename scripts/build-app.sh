#!/usr/bin/env bash
# Build a packaged Guide.app / .zip.
#
# Steps:
#   1. Compile the bun sidecar (TS + npm deps + bun runtime) into a single
#      executable, named with the Rust target triple Tauri expects.
#   2. Run `tauri build`, which bundles the sidecar binary + prompts +
#      pi-coding-agent's package.json into Guide.app.
#   3. Ad-hoc sign the app bundle and produce a zip for transfer.
#
# Output: src-tauri/target/release/bundle/macos/

set -euo pipefail

cd "$(dirname "$0")/.."

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) BUN_TARGET=bun-darwin-arm64; RUST_TARGET=aarch64-apple-darwin ;;
  Darwin-x86_64) BUN_TARGET=bun-darwin-x64; RUST_TARGET=x86_64-apple-darwin ;;
  Linux-x86_64) BUN_TARGET=bun-linux-x64; RUST_TARGET=x86_64-unknown-linux-gnu ;;
  *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

SIDECAR_OUT="src-tauri/binaries/guide-sidecar-${RUST_TARGET}"

echo "==> compiling sidecar -> ${SIDECAR_OUT}"
mkdir -p src-tauri/binaries
bun build --compile \
  --target="${BUN_TARGET}" \
  ./sidecar/index.ts \
  --outfile "${SIDECAR_OUT}"

echo "==> tauri build"
bun run tauri build

# Tauri's dmg bundler drives Finder via AppleScript to lay out the volume
# window, which times out unless the terminal has Automation permission for
# Finder. We skip Tauri's dmg target (above) and produce a plain dmg with
# hdiutil — no window styling, just an installable container.
if [[ "$(uname -s)" == "Darwin" ]]; then
  APP_PATH="src-tauri/target/release/bundle/macos/Guide.app"
  VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version" 2>/dev/null || echo 0.1.0)"
  ZIP_PATH="Guide-${VERSION}-${RUST_TARGET%-apple-darwin}-macos.zip"
  DMG_PATH="src-tauri/target/release/bundle/macos/Guide_${VERSION}_${RUST_TARGET%-apple-darwin}.dmg"
  echo "==> ad-hoc signing -> ${APP_PATH}"
  codesign --force --deep --sign - "${APP_PATH}"
  codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

  echo "==> creating zip -> ${ZIP_PATH}"
  rm -f "${ZIP_PATH}"
  ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ZIP_PATH}"

  if [[ "${GUIDE_BUILD_DMG:-0}" == "1" ]]; then
    echo "==> creating dmg -> ${DMG_PATH}"
    rm -f "${DMG_PATH}"
    hdiutil create \
      -volname Guide \
      -srcfolder "${APP_PATH}" \
      -ov \
      -format UDZO \
      "${DMG_PATH}" >/dev/null
  else
    echo "==> skipping dmg (set GUIDE_BUILD_DMG=1 to enable)"
  fi
fi

echo
echo "Done. Artifacts:"
find src-tauri/target/release/bundle -maxdepth 4 \( -name '*.app' -o -name '*.dmg' \) -print
find . -maxdepth 1 -name 'Guide-*-macos.zip' -print
