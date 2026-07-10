#!/bin/bash
# Regenerate a pack's full README: the themed statusline shot (assets/statusline.svg) and the README.md that
# embeds it. One command per pack, so a future pack ships with a single call.
#
#   bun run build && bun run pack:readme packages/packs/batman
#
# Requires the built lean binary (bun run build) for the shot. The two steps are also runnable on their own:
# scripts/assets/pack-shot.sh for the image, `bun packages/core/src/packs/readme.ts` for the README.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$PWD"

PACK_DIR="${1:-}"
[ -n "$PACK_DIR" ] || {
	echo "usage: pack-readme <pack-dir>   (e.g. packages/packs/batman)" >&2
	exit 2
}
[ -f "$PACK_DIR/pack.json" ] || {
	echo "no pack.json in $PACK_DIR" >&2
	exit 2
}

scripts/assets/pack-shot.sh "$PACK_DIR"
bun "$REPO_ROOT/packages/core/src/packs/readme.ts" "$PACK_DIR"
