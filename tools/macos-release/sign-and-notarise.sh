#!/usr/bin/env bash
# Signs the Mac app built by CI with a Developer ID certificate and has Apple notarise it, on
# Linux, with rcodesign (https://github.com/indygreg/apple-platform-rs). Waiting for Apple can take
# from minutes to hours; doing it here keeps that wait off the macOS runners.
#
# Usage: tools/macos-release/sign-and-notarise.sh <CI Mac artifact> <out-dir>
#   The artifact is Sala_<version>_universal-adhoc.app.tar.gz from the CI "macOS" build (or a
#   .dmg made by Tauri). Writes <out-dir>/Sala_<version>_universal.zip: the signed app with
#   Apple's notarisation ticket stapled, ready for the download page.
#
# Environment:
#   SALA_SIGN_KEY        PEM private key of the Developer ID Application certificate
#   SALA_SIGN_CERT       PEM of that certificate. Pass the certificate itself, not a .p12:
#                        from a .p12 rcodesign may pick Apple's intermediate instead.
#   SALA_NOTARY_ISSUER   App Store Connect API issuer ID
#   SALA_NOTARY_KEY_ID   App Store Connect API key ID
#   SALA_NOTARY_P8       path to that key's .p8, or "-" to read it from stdin
#   RCODESIGN            rcodesign binary (default: rcodesign on PATH)
# Needs tar, zip, unzip and, for a .dmg, 7z.

set -euo pipefail

usage() { sed -n '6,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
if [ $# -ne 2 ] || [ ! -f "$1" ]; then usage; fi
artifact="$1"
mkdir -p "$2"
out="$(cd "$2" && pwd)"
rcodesign="${RCODESIGN:-rcodesign}"
for v in SALA_SIGN_KEY SALA_SIGN_CERT SALA_NOTARY_ISSUER SALA_NOTARY_KEY_ID SALA_NOTARY_P8; do
  [ -n "${!v:-}" ] || { echo "FATAL: $v is not set" >&2; exit 2; }
done

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The API key never stays on disk: a private copy for this run, removed on exit.
if [ "$SALA_NOTARY_P8" = "-" ]; then cat > "$work/key.p8"; else cp "$SALA_NOTARY_P8" "$work/key.p8"; fi

echo "==> unpacking $(basename "$artifact")"
case "$artifact" in
  *.tar.gz) tar -xzf "$artifact" -C "$work" ;;
  # A Tauri disk image also holds a link to /Applications, which 7z rightly refuses to follow.
  *.dmg) 7z x -snl -y "$artifact" -o"$work/dmg" >/dev/null || true; mv "$work"/dmg/*/Sala.app "$work/" ;;
  *) usage ;;
esac
app="$work/Sala.app"
[ -d "$app" ] || { echo "FATAL: no Sala.app in $artifact" >&2; exit 1; }
version="$(sed -n '/<key>CFBundleShortVersionString<\/key>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' "$app/Contents/Info.plist")"
[ -n "$version" ] || { echo "FATAL: no version in Info.plist" >&2; exit 1; }

echo "==> signing Sala $version with the Developer ID certificate"
"$rcodesign" sign --pem-file "$SALA_SIGN_KEY" --pem-file "$SALA_SIGN_CERT" \
  --code-signature-flags runtime --for-notarization "$app"

echo "==> notarising (Apple can take a while; nothing is billed while waiting)"
"$rcodesign" encode-app-store-connect-api-key -o "$work/key.json" \
  "$SALA_NOTARY_ISSUER" "$SALA_NOTARY_KEY_ID" "$work/key.p8" >/dev/null
rm -f "$work/key.p8"
"$rcodesign" notary-submit --api-key-file "$work/key.json" --wait --max-wait-seconds 21600 --staple "$app"
rm -f "$work/key.json"

# The stapled ticket was written under umask 077; the app's files are readable by everyone.
chmod -R u+rwX,go+rX "$app"
zipfile="$out/Sala_${version}_universal.zip"
rm -f "$zipfile"
(cd "$work" && zip -q -r -y -X "$zipfile" Sala.app)
chmod 644 "$zipfile"
for bin in "$app"/Contents/MacOS/*; do
  if "$rcodesign" verify "$bin" >/dev/null 2>&1; then echo "==> signature verified: $(basename "$bin")"
  else echo "WARNING: rcodesign verify reported problems with $(basename "$bin")" >&2; fi
done
echo "==> $zipfile"
sha256sum "$zipfile"
