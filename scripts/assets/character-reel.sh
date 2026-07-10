#!/bin/bash
# Build the "meet the roster" character reel: a high-quality MP4 that cross-fades through every pack, each
# rendered LIVE in a DIFFERENT session state — so the statusline widgets, the 💡 helpful tip, and the
# in-character comment all differ from card to card (not the same shot recolored).
#
# Per card it stages an isolated sandbox (throwaway git repo + cost tree + config + payload + a seeded
# classify event for mood), renders the real binary, turns the ANSI into an SVG via statusline-svg.mjs, and
# rasterizes it with Chrome headless (faithful color emoji + braille). ffmpeg cross-fades the 2x PNGs into an
# H.264 MP4 (for social), then derives a slightly slower, size-capped GIF (for the README, which animates
# committed GIFs inline). No network, no tokens.
#
# New packs are picked up automatically: any dir under packages/packs/* that the engine can load is included
# (known ones lead in a curated order; anything new is appended). Nothing to edit here to add a character.
#
#   bun run build && scripts/assets/character-reel.sh    # -> assets/characters.mp4 + assets/characters.gif
#
# Tunables (env): HOLD (1.0), XFADE (0.25), FPS (30), SCALE (2), COLS (160), LIMIT (0=all), OUT, GIF,
# GIF_W (1740), GIF_FPS (18), GIF_SLOW (1.3).
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$PWD"
BIN="$REPO_ROOT/packages/core/dist/ccsidekick-render.js"
SVG="$REPO_ROOT/scripts/assets/statusline-svg.mjs"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -f "$BIN" ] || { echo "build first: bun run build" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set \$CHROME)" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }

HOLD="${HOLD:-1.0}"; XFADE="${XFADE:-0.25}"; FPS="${FPS:-30}"; SCALE="${SCALE:-2}"
COLS="${COLS:-160}"; LIMIT="${LIMIT:-0}"
OUT="${OUT:-assets/characters.mp4}"; GIF="${GIF:-assets/characters.gif}"
GIF_W="${GIF_W:-1740}"; GIF_FPS="${GIF_FPS:-18}"; GIF_SLOW="${GIF_SLOW:-1.3}"  # README GIF: scaled + slower

# --- pack discovery: curated lead order, then auto-append any other loadable pack -------------------
CURATED=(spiderman batman iron-man deadpool joker darth-vader superman naruto pikachu \
         yoda gandalf harry-potter sherlock-holmes james-bond barbie hello-kitty ben10 shinchan)
present=()
for d in "$REPO_ROOT"/packages/packs/*/; do
	n="$(basename "$d")"; [ -f "$d/pack.json" ] && present+=("$n")
done
in_list() { local x="$1"; shift; for e in "$@"; do [ "$e" = "$x" ] && return 0; done; return 1; }
PACKS=()
for n in "${CURATED[@]}"; do in_list "$n" "${present[@]}" && PACKS+=("$n"); done
for n in "${present[@]}"; do in_list "$n" "${PACKS[@]}" || PACKS+=("$n"); done  # new packs, appended
[ "$LIMIT" -gt 0 ] && PACKS=("${PACKS[@]:0:$LIMIT}")

# --- scenario matrix: cycled across cards so state varies (widgets, 💡 tip, mood) ------------------
# Fields via globals set by apply_scenario: model id/name, effort, thinking, ctx%, 5h%, 7d%, PR, chat$,
# session tokens (drive context read + Project/Total), a seeded event (mood), branch, git variant.
apply_scenario() {
	case "$1" in
	0) SC=(claude-sonnet-4-5 "Sonnet 4.5" "" false 22 34 40 none 0.12 8000 3000 Bash "bun test" pass main clean) ;;
	1) SC=(claude-opus-4-8 "Opus 4.8" high true 43 86 63 "42:approved" 0.87 12000 4000 Bash "bun test" fail feat/widget-layer dirty) ;;
	2) SC=(claude-opus-4-8 "Opus 4.8" high false 61 55 78 "7:changes_requested" 1.90 90000 30000 Bash "git commit -m x" pass release/v1 dirty) ;;
	3) SC=(claude-sonnet-4-5 "Sonnet 4.5" "" true 88 30 45 none 0.55 40000 12000 Edit "src/layout.ts" pass fix/race dirty) ;;
	4) SC=(claude-opus-4-8 "Opus 4.8" high false 8 12 20 none 0.03 1500 400 none "" "" main clean) ;;
	5) SC=(claude-opus-4-8 "Opus 4.8" high true 51 92 88 "99:approved" 2.40 70000 22000 Bash "git push --force" pass hotfix/urgent dirty) ;;
	esac
	SC_MODEL_ID="${SC[0]}"; SC_MODEL_NAME="${SC[1]}"; SC_EFFORT="${SC[2]}"; SC_THINK="${SC[3]}"
	SC_CTX="${SC[4]}"; SC_BLOCK="${SC[5]}"; SC_WEEK="${SC[6]}"; SC_PR="${SC[7]}"; SC_CHAT="${SC[8]}"
	SC_TOKIN="${SC[9]}"; SC_TOKOUT="${SC[10]}"; SC_EVTOOL="${SC[11]}"; SC_EVCMD="${SC[12]}"
	SC_EVOK="${SC[13]}"; SC_BRANCH="${SC[14]}"; SC_GITVAR="${SC[15]}"
}
NSCEN=6

FIVE_H_AT="$(node -e 'console.log(Math.floor(Date.now()/1000)+2*3600+14*60)')"
SEVEN_D_AT="$(node -e 'console.log(Math.floor(Date.now()/1000)+3*86400+5*3600)')"

# Render one card SVG for pack $1 using the currently-applied scenario, into file $2.
render_card() {
	local pack="$1" outsvg="$2"
	local title; title="$(node -e 'try{process.stdout.write(require(process.argv[1]).displayName)}catch{process.stdout.write(process.argv[2])}' "$REPO_ROOT/packages/packs/$pack/pack.json" "$pack")"
	local W; W="$(mktemp -d)"
	local REPO="$W/repo" CFG="$W/cfg" PROJ="$W/cfg/projects"
	mkdir -p "$CFG/ccsidekick"

	# git repo in the scenario's state (quiet)
	{
		git init -q --bare "$W/origin.git"; git -C "$W/origin.git" config core.hooksPath /dev/null
		git init -q -b "$SC_BRANCH" "$REPO"; cd "$REPO"
		git config core.hooksPath /dev/null; git config user.email d@e; git config user.name d
		git remote add origin "$W/origin.git"
		printf 'export const A = 1;\n' > a.ts; printf '# readme\n' > README.md
		git add -A; git commit -qm base; git push -q -u origin "$SC_BRANCH"
		if [ "$SC_GITVAR" = "dirty" ]; then
			printf 'export const B = 2;\n' >> a.ts; git commit -qam ahead        # ahead by 1
			printf 'export const C = 3;\n' >> a.ts; git add a.ts                  # staged
			printf '\nedit\n' >> README.md                                       # unstaged
			printf 'scratch\n' > notes.local.md                                  # untracked
		fi
		cd "$REPO_ROOT"
	} >/dev/null 2>&1

	# cost tree: this project (drives Project + Total) and a second project (Total only)
	local enc; enc="$(echo "$REPO" | sed 's/[/.]/-/g')"
	mkdir -p "$PROJ/$enc" "$PROJ/-home-dev-other"
	printf '{"type":"assistant","sessionId":"sp","requestId":"P","timestamp":"2026-07-01T10:00:00.000Z","message":{"id":"MP","model":"claude-opus-4-8","usage":{"input_tokens":30000,"output_tokens":10000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n' > "$PROJ/-home-dev-other/o.jsonl"
	printf '{"type":"assistant","sessionId":"sess-demo","requestId":"D","timestamp":"2026-07-01T00:00:00.000Z","message":{"id":"MD","model":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":60000,"cache_creation_input_tokens":8000,"speed":"fast"}}}\n' "$SC_MODEL_ID" "$SC_TOKIN" "$SC_TOKOUT" > "$PROJ/$enc/sess-demo.jsonl"

	# config: pin character + its own theme, helpful on, thinking widget on
	cat > "$CFG/ccsidekick/config.toml" <<TOML
schema_version = 1
[character]
mode = "fixed"
name = "$pack"
[helpful]
enabled = true
min_severity = "low"
[line.widgets]
thinking = true
[theme]
name = "character"
[network]
fx_refresh = false
usage_fetch = false
TOML

	# payload
	local effort_json="" think_json="" pr_json=""
	[ -n "$SC_EFFORT" ] && effort_json="\"effort\": { \"level\": \"$SC_EFFORT\" },"
	think_json="\"thinking\": { \"enabled\": $SC_THINK },"
	if [ "$SC_PR" != "none" ]; then
		pr_json="\"pr\": { \"number\": ${SC_PR%%:*}, \"url\": \"https://github.com/krayong/ccsidekick/pull/${SC_PR%%:*}\", \"review_state\": \"${SC_PR##*:}\" },"
	fi
	cat > "$W/payload.json" <<JSON
{
  "session_id": "sess-demo",
  "transcript_path": "$PROJ/$enc/sess-demo.jsonl",
  "cwd": "$REPO",
  "workspace": { "current_dir": "$REPO", "repo": { "host": "github.com", "owner": "krayong", "name": "ccsidekick" } },
  "model": { "id": "$SC_MODEL_ID", "display_name": "$SC_MODEL_NAME" },
  $effort_json
  $think_json
  $pr_json
  "cost": { "total_cost_usd": $SC_CHAT, "total_duration_ms": 184320 },
  "context_window": { "used_percentage": $SC_CTX, "total_input_tokens": $(( SC_CTX * 10000 )), "context_window_size": 1000000 },
  "rate_limits": {
    "five_hour": { "used_percentage": $SC_BLOCK, "resets_at": $FIVE_H_AT },
    "seven_day": { "used_percentage": $SC_WEEK, "resets_at": $SEVEN_D_AT }
  }
}
JSON

	# seed the mood event (unless idle)
	if [ "$SC_EVTOOL" != "none" ]; then
		local so="" se=""
		[ "$SC_EVOK" = "fail" ] && se="1 fail FAIL" || so="ok pass"
		printf '{"hook_event_name":"PostToolUse","session_id":"sess-demo","tool_name":"%s","tool_input":{"command":"%s"},"tool_response":{"stdout":"%s","stderr":"%s"}}' \
			"$SC_EVTOOL" "$SC_EVCMD" "$so" "$se" | CLAUDE_CONFIG_DIR="$CFG" node "$BIN" classify >/dev/null 2>&1 || true
	fi

	CLAUDE_CONFIG_DIR="$CFG" COLUMNS="$COLS" node "$BIN" render < "$W/payload.json" \
		| sed "s#/private$REPO#~/dev/ccsidekick#g; s#$REPO#~/dev/ccsidekick#g" \
		| SVG_RADIUS=0 bun "$SVG" "$title — ccsidekick" > "$outsvg"
	rm -rf "$W"
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pngs=(); i=0
for pack in "${PACKS[@]}"; do
	# +1 offset so the lead card (spiderman) lands on a full state (PR + 💡 tip + dirty git), not the sparse one
	apply_scenario "$(( (i + 1) % NSCEN ))"
	svgf="$TMP/$(printf '%02d' "$i")-$pack.svg"
	render_card "$pack" "$svgf"
	W=$(grep -m1 -oE 'width="[0-9]+"' "$svgf" | grep -oE '[0-9]+')
	H=$(grep -m1 -oE 'height="[0-9]+"' "$svgf" | grep -oE '[0-9]+')
	png="$TMP/$(printf '%02d' "$i")-$pack.png"
	# default bg = card color so the SVG's rounded-corner gaps rasterize dark, not white
	"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor="$SCALE" \
		--window-size="${W},${H}" --default-background-color=0d1117ff --screenshot="$png" "file://$svgf" >/dev/null 2>&1
	pngs+=("$png")
	i=$((i + 1))
done
echo "rendered ${#pngs[@]} fresh cards"

# common canvas = max PNG dims (top-left aligned; card bg == pad color so no visible seam)
maxW=0; maxH=0
for p in "${pngs[@]}"; do
	d=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$p")
	w=${d%x*}; h=${d#*x}
	[ "$w" -gt "$maxW" ] && maxW=$w; [ "$h" -gt "$maxH" ] && maxH=$h
done
# even dimensions for H.264
maxW=$(( (maxW + 1) / 2 * 2 )); maxH=$(( (maxH + 1) / 2 * 2 ))

step=$(awk "BEGIN{print $HOLD-$XFADE}")
inputs=(); filter=""
for idx in "${!pngs[@]}"; do
	inputs+=(-loop 1 -t "$HOLD" -i "${pngs[$idx]}")
	filter+="[$idx:v]pad=$maxW:$maxH:0:0:color=0x0d1117,fps=$FPS,format=rgba,setsar=1[v$idx];"
done
prev="[v0]"
for ((k = 1; k < ${#pngs[@]}; k++)); do
	off=$(awk "BEGIN{printf \"%.3f\", $k*$step}")
	filter+="${prev}[v$k]xfade=transition=fade:duration=$XFADE:offset=$off[x$k];"
	prev="[x$k]"
done
filter+="${prev}format=yuv420p[out]"

mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" -map "[out]" \
	-c:v libx264 -preset slow -crf 18 -movflags +faststart "$OUT"
dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT" 2>/dev/null)
echo "wrote $OUT  (${#pngs[@]} cards, ${maxW}x${maxH}, ${dur}s)"

# --- README GIF: a bit slower (setpts) + scaled, two-pass palette for quality, size-capped --------
# GitHub animates committed GIFs inline; keep it under ~15MB (Twitter's cap) by trimming width/fps.
gifchain="setpts=${GIF_SLOW}*PTS,fps=${GIF_FPS},scale=${GIF_W}:-1:flags=lanczos"
pal="$TMP/gifpal.png"
ffmpeg -y -loglevel error -i "$OUT" -vf "${gifchain},palettegen=stats_mode=diff:max_colors=256" "$pal"
ffmpeg -y -loglevel error -i "$OUT" -i "$pal" \
	-lavfi "${gifchain}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" "$GIF"
gsz=$(( $(stat -f%z "$GIF" 2>/dev/null || stat -c%s "$GIF") / 1048576 ))
echo "wrote $GIF  (${GIF_W}px, ${GIF_FPS}fps, ~${gsz}MB)"
[ "$gsz" -gt 15 ] && echo "  note: >15MB — lower GIF_W or GIF_FPS" >&2 || true
