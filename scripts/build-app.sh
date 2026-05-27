#!/usr/bin/env bash
# Build a packaged Cairn.app / .zip.
#
# Steps:
#   1. Run `tauri build`; Tauri's `beforeBuildCommand` compiles the frontend
#      and sidecar binary, then bundles the sidecar + prompts +
#      pi-coding-agent's package.json into Cairn.app.
#   2. Ad-hoc sign the app bundle and produce a zip for transfer.
#
# Output: src-tauri/target/release/bundle/macos/

set -euo pipefail

cd "$(dirname "$0")/.."

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) RUST_TARGET=aarch64-apple-darwin ;;
  Darwin-x86_64) RUST_TARGET=x86_64-apple-darwin ;;
  Linux-x86_64) RUST_TARGET=x86_64-unknown-linux-gnu ;;
  *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

echo "==> tauri build"
bun run tauri build

# Tauri's dmg bundler drives Finder via AppleScript to lay out the volume
# window, which times out unless the terminal has Automation permission for
# Finder. We skip Tauri's dmg target (above) and produce a plain dmg with
# hdiutil — no window styling, just an installable container.
if [[ "$(uname -s)" == "Darwin" ]]; then
  APP_PATH="src-tauri/target/release/bundle/macos/Cairn.app"
  VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version" 2>/dev/null || echo 0.1.0)"
  ZIP_PATH="Cairn-${VERSION}-${RUST_TARGET%-apple-darwin}-macos.zip"
  DMG_PATH="src-tauri/target/release/bundle/macos/Cairn_${VERSION}_${RUST_TARGET%-apple-darwin}.dmg"
  echo "==> ad-hoc signing -> ${APP_PATH}"
  codesign --force --deep --sign - "${APP_PATH}"
  codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

  echo "==> creating zip -> ${ZIP_PATH}"
  rm -f "${ZIP_PATH}"
  ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ZIP_PATH}"

  if [[ "${CAIRN_BUILD_DMG:-0}" == "1" ]]; then
    echo "==> creating dmg -> ${DMG_PATH}"
    rm -f "${DMG_PATH}"
    hdiutil create \
      -volname Cairn \
      -srcfolder "${APP_PATH}" \
      -ov \
      -format UDZO \
      "${DMG_PATH}" >/dev/null
  else
    echo "==> skipping dmg (set CAIRN_BUILD_DMG=1 to enable)"
  fi
fi

echo
echo "Done. Artifacts:"
find src-tauri/target/release/bundle -maxdepth 4 \( -name '*.app' -o -name '*.dmg' \) -print
find . -maxdepth 1 -name 'Cairn-*-macos.zip' -print
