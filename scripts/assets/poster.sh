#!/usr/bin/env bash
# Regenerate assets/characters-poster.jpg from Spider-Man's default-theme statusline render.
# The poster is the landing page's <video poster> and the og:image / twitter:image. It is derived from
# the committed spiderman pack shot (packages/packs/spiderman/assets/statusline.svg), rasterized with
# Chrome headless (faithful color emoji + braille, same path the reel uses), so it stays in the pack's
# own theme. Local tooling only (needs Chrome + ImageMagick), like character:reel.
#
#   bun run poster            # -> assets/characters-poster.jpg
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVG="$REPO_ROOT/packages/packs/spiderman/assets/statusline.svg"
OUT="${OUT:-$REPO_ROOT/assets/characters-poster.jpg}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
W=1128
H=228

[ -f "$SVG" ] || { echo "missing $SVG (run: bun run pack:shot packages/packs/spiderman)" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set \$CHROME)" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick 'magick' not found (brew install imagemagick)" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
	--window-size="${W},${H}" --default-background-color=0d1117ff \
	--screenshot="$TMP/poster.png" "file://$SVG" >/dev/null 2>&1

# downscale the 2x shot to the poster's reserved dimensions (1740x352, the <video> box aspect)
magick "$TMP/poster.png" -resize 1740x352 -quality 88 "$OUT"
echo "wrote $OUT  ($(sips -g pixelWidth -g pixelHeight "$OUT" | tail -2 | tr -d ' \n' | sed 's/pixelWidth:/w=/;s/pixelHeight:/ h=/'))"
