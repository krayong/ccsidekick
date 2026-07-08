#!/bin/bash
# Regenerate a pack's README statusline shot (packages/packs/<pack>/assets/statusline.svg) from a real render,
# rendered in the pack's OWN theme. Given a pack directory it stages a
# throwaway git repo + cost tree + a config that pins the character to the pack (fixed mode) AND selects the
# pack's registered theme, renders the lean binary at a fixed width, and pipes the ANSI through
# scripts/assets/statusline-svg.mjs. The pack's theme resolves because it registers under the pack name and the
# pack is workspace-symlinked into node_modules.
#
#   bun run build && scripts/assets/pack-shot.sh packages/packs/batman
#
# Portable: epoch timestamps come from node, not macOS-only `date -v`, so it runs on Linux/CI too.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$PWD"
BIN="$REPO_ROOT/packages/core/dist/ccsidekick-render.js"
[ -f "$BIN" ] || { echo "build first: bun run build" >&2; exit 1; }

PACK_DIR="${1:-}"
[ -n "$PACK_DIR" ] || { echo "usage: pack-shot.sh <pack-dir>   (e.g. packages/packs/batman)" >&2; exit 2; }
[ -f "$PACK_DIR/pack.json" ] || { echo "no pack.json in $PACK_DIR" >&2; exit 2; }
PACK_NAME="$(node -e 'process.stdout.write(require(process.argv[1]).name)' "$REPO_ROOT/$PACK_DIR/pack.json")"
PACK_TITLE="$(node -e 'process.stdout.write(require(process.argv[1]).displayName)' "$REPO_ROOT/$PACK_DIR/pack.json")"

# Portable epoch timestamps for the quota resets (block ~2h14m out, weekly ~3d5h out).
NOW="$(node -e 'console.log(Math.floor(Date.now()/1000))')"
FIVE_H_AT="$(node -e 'console.log(Math.floor(Date.now()/1000)+2*3600+14*60)')"
SEVEN_D_AT="$(node -e 'console.log(Math.floor(Date.now()/1000)+3*86400+5*3600)')"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/repo"; CFG="$WORK/cfg"; PROJ="$CFG/projects"
mkdir -p "$CFG/ccsidekick"

# --- real git repo: branch + staged/unstaged/untracked + ahead of upstream ------------------------
git init -q --bare "$WORK/origin.git"
git -C "$WORK/origin.git" config core.hooksPath /dev/null
git init -q -b feat/widget-layer "$REPO"
cd "$REPO"
git config core.hooksPath /dev/null
git config user.email demo@ccsidekick.dev; git config user.name "ccsidekick demo"
git remote add origin "$WORK/origin.git"
printf 'export const FRAME_PERIOD_MS = 400;\nexport const MIN_RIGHT_WIDTH = 30;\n' > constants.ts
printf '# ccsidekick\nA reactive Claude Code statusline.\n' > README.md
git add -A; git commit -qm "base: constants + readme"
git push -q -u origin feat/widget-layer
printf 'export const GAP = 2;\n' >> constants.ts; git commit -qam "layout: add gap"   # ahead by 1
printf 'export const SEP = "|";\n' >> constants.ts; git add constants.ts              # staged
printf '\n<!-- widgets: branch, cost, block -->\n' >> README.md                        # unstaged
printf 'scratch\n' > notes.local.md                                                    # untracked

# --- projects cost tree: current cwd -> Project & Total; a 2nd project -> Total only --------------
enc() { echo "$1" | sed 's/[/.]/-/g'; }
SAME="$PROJ/$(enc "$REPO")"; OTHER="$PROJ/-home-dev-other-repo"
mkdir -p "$SAME" "$OTHER"
line() { printf '{"type":"assistant","sessionId":"%s","requestId":"%s","timestamp":"2026-06-30T10:00:00.000Z","message":{"id":"%s","model":"claude-opus-4-8","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n' "$1" "$2" "$3" "$4" "$5"; }
line sess-past  P1 MP1 40000 20000 > "$SAME/sess-past.jsonl"    # ~same-project history
line sess-other O1 MO1 30000 10000 > "$OTHER/sess-other.jsonl"  # ~other project
# current session transcript: speed=fast drives the Fast widget; some cache for a realistic context read.
printf '{"type":"assistant","sessionId":"sess-demo","requestId":"D1","timestamp":"2026-07-01T00:00:00.000Z","message":{"id":"MD1","model":"claude-opus-4-8","usage":{"input_tokens":12000,"output_tokens":4000,"cache_read_input_tokens":60000,"cache_creation_input_tokens":8000,"speed":"fast"}}}\n' > "$SAME/sess-demo.jsonl"

# --- config: pin the character AND the theme to this pack, network off, helpful + thinking on -----
cat > "$CFG/ccsidekick/config.toml" <<TOML
schema_version = 1

[character]
mode = "fixed"
name = "$PACK_NAME"

[helpful]
enabled = true
min_severity = "low"

[line.widgets]
thinking = true

[theme]
name = "$PACK_NAME"

[network]
fx_refresh = false
usage_fetch = false
TOML

# --- payload: 1M window, thinking on, block high (-> helpful), weekly, PR -------------------------
cat > "$WORK/payload.json" <<JSON
{
  "session_id": "sess-demo",
  "transcript_path": "$SAME/sess-demo.jsonl",
  "cwd": "$REPO",
  "workspace": { "current_dir": "$REPO", "repo": { "host": "github.com", "owner": "krayong", "name": "ccsidekick" } },
  "model": { "id": "claude-opus-4-8", "display_name": "Claude Opus 4.8" },
  "effort": { "level": "high" },
  "thinking": { "enabled": true },
  "cost": { "total_cost_usd": 0.87, "total_duration_ms": 184320 },
  "context_window": { "used_percentage": 43.0, "total_input_tokens": 430000, "context_window_size": 1000000 },
  "rate_limits": {
    "five_hour": { "used_percentage": 86.0, "resets_at": $FIVE_H_AT },
    "seven_day": { "used_percentage": 63.0, "resets_at": $SEVEN_D_AT }
  },
  "pr": { "number": 42, "url": "https://github.com/krayong/ccsidekick/pull/42", "review_state": "approved" }
}
JSON

# --- render (fixed width keeps every field), prettify the path, emit the SVG ----------------------
# 160 cols keeps every field (thinking/fast on row 1, block on row 4) from shedding. readGit resolves the temp
# dir through /private on macOS, so strip that prefix too when rewriting the path.
OUT_DIR="$REPO_ROOT/$PACK_DIR/assets"
mkdir -p "$OUT_DIR"
CLAUDE_CONFIG_DIR="$CFG" COLUMNS=160 node "$BIN" render < "$WORK/payload.json" \
  | sed "s#/private$REPO#~/dev/ccsidekick#g; s#$REPO#~/dev/ccsidekick#g" \
  | node "$REPO_ROOT/scripts/assets/statusline-svg.mjs" "$PACK_TITLE — ccsidekick" \
  > "$OUT_DIR/statusline.svg"
echo "wrote $PACK_DIR/assets/statusline.svg"
