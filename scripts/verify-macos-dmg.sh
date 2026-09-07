#!/bin/bash
# Read-only validation of the actual packaged app; no Gatekeeper changes.
set -euo pipefail
cj_dmg=${1:?Usage: verify-macos-dmg.sh DMG VERSION}
cj_version=${2:?Expected app version is required}
test -f "$cj_dmg"
hdiutil verify "$cj_dmg"
cj_mount=$(mktemp -d "${TMPDIR:-/tmp}/coinjura-dmg-check.XXXXXX")
cj_attached=0
cj_cleanup() {
  if [ "$cj_attached" -eq 1 ]; then
    hdiutil detach "$cj_mount" -quiet || return 1
  fi
  rmdir "$cj_mount"
}
trap cj_cleanup EXIT
hdiutil attach "$cj_dmg" -readonly -nobrowse -mountpoint "$cj_mount" -quiet
cj_attached=1
cj_app="$cj_mount/Coinjura Widget.app"
test -d "$cj_app"
codesign --verify --deep --strict --verbose=2 "$cj_app"
codesign --display --verbose=2 "$cj_app"
test -s "$cj_app/Contents/_CodeSignature/CodeResources"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$cj_app/Contents/Info.plist")" = 'com.coinjura.widget'
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$cj_app/Contents/Info.plist")" = "$cj_version"
lipo "$cj_app/Contents/MacOS/coinjura-widget" -verify_arch arm64
echo "Verified DMG integrity, app signature, bundle ID, version and arm64 architecture."
