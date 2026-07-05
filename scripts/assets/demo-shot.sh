#!/bin/bash
# Regenerate the README statusline shot (assets/statusline.svg) from a real render.
# Stages a throwaway git repo + cost tree + config + payload in a temp dir, renders the lean binary at a fixed
# width, rewrites the demo path to a friendly one, and pipes the ANSI through scripts/assets/statusline-svg.mjs.
#
#   bun run build && scripts/assets/demo-shot.sh   # writes assets/statusline.svg
#
# The staged inputs are chosen to exercise the full widget set: git branch + changes + ahead, chat/project/total
# cost, block/weekly quota (block high, which also trips a helpful tip), thinking + fast mode, and a 1M window.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$PWD"
BIN="$REPO_ROOT/packages/core/dist/ccsidekick-render.js"
[ -f "$BIN" ] || { echo "build first: bun run build" >&2; exit 1; }

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

# --- config: defaults + network off + helpful on + thinking widget on ----------------------------
cat > "$CFG/ccsidekick/config.toml" <<'TOML'
schema_version = 1

[character]
mode = "fixed"
name = "batman"

[helpful]
enabled = true
min_severity = "low"

[line.widgets]
thinking = true

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
    "five_hour": { "used_percentage": 86.0, "resets_at": $(date -v+2H -v+14M +%s) },
    "seven_day": { "used_percentage": 63.0, "resets_at": $(date -v+3d -v+5H +%s) }
  },
  "pr": { "number": 42, "url": "https://github.com/krayong/ccsidekick/pull/42", "review_state": "approved" }
}
JSON

# --- render (fixed width keeps every field), prettify the path, emit the SVG ----------------------
# 160 cols keeps every field (thinking/fast on row 1, block on row 4) from shedding. readGit resolves the temp
# dir through /private on macOS, so strip that prefix too when rewriting the path.
CLAUDE_CONFIG_DIR="$CFG" COLUMNS=160 node "$BIN" render < "$WORK/payload.json" \
  | sed "s#/private$REPO#~/dev/ccsidekick#g; s#$REPO#~/dev/ccsidekick#g" \
  | node "$REPO_ROOT/scripts/assets/statusline-svg.mjs" "ccsidekick — statusLine" \
  > "$REPO_ROOT/assets/statusline.svg"
echo "wrote assets/statusline.svg"
