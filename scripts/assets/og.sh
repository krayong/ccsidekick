#!/usr/bin/env bash
# Regenerate assets/og.png — the 1280x640 Open Graph / social-share card (og:image / twitter:image).
# Content sits inside a 60px safe margin on all four sides.
#
# The card is built in two passes because no single rasterizer does both jobs well:
#   1. The hero is the real Spider-Man status-line render (packages/packs/spiderman/assets/statusline.svg).
#      It contains COLOR EMOJI (the widget icons), which rsvg-convert cannot render — so it is screenshotted
#      with Chrome headless (the same path scripts/assets/poster.sh uses), on a transparent background so its
#      rounded corners let the panel behind show through.
#   2. The frame (page background, wordmark, tagline, the bordered+shadowed panel, and the feature line) has no
#      emoji, so it rasterizes crisply with rsvg-convert.
# ImageMagick then composites the statusline into the panel and downscales 2x -> 1x with Lanczos for sharp text.
#
# Requires: Chrome, rsvg-convert, magick (ImageMagick). Usage: bun run og   (-> assets/og.png)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="${OUT:-$REPO_ROOT/assets/og.png}"
STATUSLINE="$REPO_ROOT/packages/packs/spiderman/assets/statusline.svg"
WORDMARK="$REPO_ROOT/assets/wordmark.svg"

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set \$CHROME)" >&2; exit 1; }
for bin in rsvg-convert magick base64; do
	command -v "$bin" >/dev/null || { echo "missing $bin" >&2; exit 1; }
done
[ -f "$STATUSLINE" ] || { echo "missing $STATUSLINE (run: bun run pack:shot packages/packs/spiderman)" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) Status line via Chrome (color emoji + correct ASCII), transparent bg so the panel shows at the corners.
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
	--window-size=1128,228 --default-background-color=00000000 \
	--screenshot="$TMP/sl.png" "file://$STATUSLINE" >/dev/null 2>&1

# 2) Emoji-free frame; wordmark embedded so rsvg needs no external file resolution.
WM="$(base64 -i "$WORDMARK" | tr -d '\n')"
cat >"$TMP/frame.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="640" viewBox="0 0 1280 640" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5fafff"/><stop offset="0.34" stop-color="#64d760"/>
      <stop offset="0.67" stop-color="#ffd687"/><stop offset="1" stop-color="#ff8c87"/>
    </linearGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="22" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>
  <rect width="1280" height="640" fill="#0b0e14"/>
  <image x="60" y="52" width="392" height="70" xlink:href="data:image/svg+xml;base64,$WM"/>
  <rect x="60" y="134" width="356" height="3" rx="1.5" fill="url(#g)"/>
  <text x="60" y="184" font-size="28" fill="#93a1b3">A Claude Code status line with a character that reacts.</text>
  <rect x="60" y="250" width="1160" height="234" rx="12" fill="#0d1117" stroke="#3a475b" stroke-width="1.5" filter="url(#sh)"/>
  <text x="60" y="577" font-size="18" fill="#7d899b">18 characters · 75+ themes · 33 widgets · zero token spend · local-first · MIT</text>
</svg>
SVG

rsvg-convert -w 2560 -h 1280 "$TMP/frame.svg" -o "$TMP/frame.png"

# 3) Composite the statusline into the panel (60,250 1160x234 -> 2x 120,500 2320x468) and downscale sharp.
magick "$TMP/frame.png" \( "$TMP/sl.png" -resize 2320x468\! \) -geometry +120+500 -composite \
	-filter Lanczos -resize 1280x640 -strip -define png:compression-level=9 "$OUT"

echo "wrote $OUT ($(magick identify -format '%wx%h, %b' "$OUT"))"
