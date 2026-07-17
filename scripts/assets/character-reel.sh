#!/bin/bash
# Build the "meet the roster" reels: cross-fade through every pack, each rendered LIVE in a DIFFERENT session
# state — so the statusline widgets, the 💡 helpful tip, and the in-character comment all differ from card to
# card (not the same shot recolored). Two of the states are deployment cards woven into the rotation:
# enterprise (Cost/Limit cap, no block/weekly) and bedrock (Cost/Limit ∞).
#
# Every card renders to one uniform width/height (SVG_MIN_COLS/ROWS), so each terminal window — and its title
# bar — spans the full frame and the cards can cross-fade cleanly. From that single set of cards it emits two
# artifacts, same characters / content / animation:
#   • assets/characters.{mp4,gif} — the bare terminal reel.
#   • assets/showcase.{mp4,gif}   — the same reel wrapped in the og card (wordmark + tagline + panel + footer).
# The MP4s are crisp H.264 (for social); the GIFs use a few key frames + short morph cross-fades with per-frame
# palettes (no dithering) so they stay sharp and small. No network, no tokens.
#
# New packs are picked up automatically: any dir under packages/packs/* that the engine can load is included
# (known ones lead in a curated order; anything new is appended). Nothing to edit here to add a character.
#
#   bun run build && scripts/assets/character-reel.sh
#
# Tunables (env): HOLD (1.0), XFADE (0.25), FPS (30), SCALE (2), COLS (160), LIMIT (0=all),
#   MORPH (4), GIF_HOLD (125), GIF_XF (4), GIF_W (1560), SHOW_GIF_W (1120),
#   OUT, GIF, SHOW_OUT, SHOW_GIF.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$PWD"
BIN="$REPO_ROOT/packages/core/dist/ccsidekick-render.js"
SVG="$REPO_ROOT/scripts/assets/statusline-svg.mjs"
WORDMARK="$REPO_ROOT/assets/wordmark.svg"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -f "$BIN" ] || { echo "build first: bun run build" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set \$CHROME)" >&2; exit 1; }
for b in ffmpeg rsvg-convert magick base64; do command -v "$b" >/dev/null || { echo "missing $b" >&2; exit 1; }; done

HOLD="${HOLD:-1.0}"; XFADE="${XFADE:-0.25}"; FPS="${FPS:-30}"; SCALE="${SCALE:-2}"
COLS="${COLS:-160}"; LIMIT="${LIMIT:-0}"
MORPH="${MORPH:-4}"; GIF_HOLD="${GIF_HOLD:-125}"; GIF_XF="${GIF_XF:-4}"
GIF_W="${GIF_W:-1560}"; SHOW_GIF_W="${SHOW_GIF_W:-1120}"
OUT="${OUT:-assets/characters.mp4}"; GIF="${GIF:-assets/characters.gif}"
SHOW_OUT="${SHOW_OUT:-assets/showcase.mp4}"; SHOW_GIF="${SHOW_GIF:-assets/showcase.gif}"
# statusline-svg geometry constants (kept in sync with statusline-svg.mjs) for the min-cols/rows math.
CELL_W=8.4; PAD=18; TITLEBAR=30; LINE_H=18

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

# --- scenario matrix: cycled across cards so state varies (widgets, 💡 tip, mood, deployment) -------
# Fields set by apply_scenario: model id/name, effort, thinking, ctx%, 5h%, 7d%, PR, chat$, session tokens,
# a seeded event (mood), branch, git variant, MODE. A deployment MODE (enterprise/bedrock) leaves 5h%/7d%
# empty (no block/weekly) and renders the Cost/Limit widget + provider badge.
apply_scenario() {
	case "$1" in
	0) SC=(claude-sonnet-4-5 "Sonnet 4.5" "" false 22 34 40 none 0.12 8000 3000 Bash "bun test" pass main clean normal) ;;
	1) SC=(claude-opus-4-8 "Opus 4.8" high true 43 86 63 "42:approved" 0.87 12000 4000 Bash "bun test" fail feat/widget-layer dirty normal) ;;
	2) SC=(claude-opus-4-8 "Opus 4.8" high false 61 55 78 "7:changes_requested" 1.90 90000 30000 Bash "git commit -m x" pass release/v1 dirty normal) ;;
	3) SC=(claude-sonnet-4-5 "Sonnet 4.5" "" true 88 30 45 none 0.55 40000 12000 Edit "src/layout.ts" pass fix/race dirty normal) ;;
	4) SC=(claude-opus-4-8 "Opus 4.8" high true 43 "" "" none 1.24 60000 18000 Bash "bun test" pass feat/widget-layer dirty enterprise) ;;
	5) SC=(claude-opus-4-8 "Opus 4.8" high true 51 92 88 "99:approved" 2.40 70000 22000 Bash "git push --force" pass hotfix/urgent dirty normal) ;;
	6) SC=(claude-opus-4-8 "Opus 4.8" high false 8 12 20 none 0.03 1500 400 none "" "" main clean normal) ;;
	7) SC=(claude-opus-4-8 "Opus 4.8" high false 37 "" "" none 0.92 48000 14000 Edit "src/render.ts" pass main clean bedrock) ;;
	esac
	SC_MODEL_ID="${SC[0]}"; SC_MODEL_NAME="${SC[1]}"; SC_EFFORT="${SC[2]}"; SC_THINK="${SC[3]}"
	SC_CTX="${SC[4]}"; SC_BLOCK="${SC[5]}"; SC_WEEK="${SC[6]}"; SC_PR="${SC[7]}"; SC_CHAT="${SC[8]}"
	SC_TOKIN="${SC[9]}"; SC_TOKOUT="${SC[10]}"; SC_EVTOOL="${SC[11]}"; SC_EVCMD="${SC[12]}"
	SC_EVOK="${SC[13]}"; SC_BRANCH="${SC[14]}"; SC_GITVAR="${SC[15]}"; SC_MODE="${SC[16]}"
}
NSCEN=8

FIVE_H_AT="$(node -e 'console.log(Math.floor(Date.now()/1000)+2*3600+14*60)')"
SEVEN_D_AT="$(node -e 'console.log(Math.floor(Date.now()/1000)+3*86400+5*3600)')"

pack_title() {
	node -e 'try{process.stdout.write(require(process.argv[1]).displayName)}catch{process.stdout.write(process.argv[2])}' "$REPO_ROOT/packages/packs/$1/pack.json" "$1"
}

# Render one card for pack $1 in the current scenario (+ $CARD_MODE), writing its raw ANSI to file $2.
render_card() {
	local pack="$1" ansiout="$2"
	local W; W="$(mktemp -d)"
	local REPO="$W/repo" CFG="$W/cfg" PROJ="$W/cfg/projects"
	mkdir -p "$CFG/ccsidekick/cache"

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

	# deployment cards ($CARD_MODE): seed the OAuth usage + creds caches so the Cost/Limit widget renders
	# (enterprise = a cap; bedrock = uncapped ∞), and pick the provider badge. Normal cards keep network off.
	local use_fetch=false provider_env=""
	local now_ms; now_ms="$(node -e 'console.log(Date.now())')"
	case "${CARD_MODE:-normal}" in
	enterprise)
		printf '{"fetchedAt":%s,"data":{"extra_usage":{"used_credits":4200,"monthly_limit":50000,"is_enabled":true}}}' "$now_ms" > "$CFG/ccsidekick/cache/usage.json"
		printf '{"at":%s,"info":{"present":true,"subscriptionType":"enterprise"}}' "$now_ms" > "$CFG/ccsidekick/cache/creds.json"
		use_fetch=true ;;
	bedrock)
		printf '{"fetchedAt":%s,"data":{"extra_usage":{"used_credits":4200,"is_enabled":true}}}' "$now_ms" > "$CFG/ccsidekick/cache/usage.json"
		use_fetch=true; provider_env="CLAUDE_CODE_USE_BEDROCK=1" ;;
	esac

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
usage_fetch = $use_fetch
TOML

	# payload
	local effort_json="" think_json="" pr_json=""
	[ -n "$SC_EFFORT" ] && effort_json="\"effort\": { \"level\": \"$SC_EFFORT\" },"
	think_json="\"thinking\": { \"enabled\": $SC_THINK },"
	if [ "$SC_PR" != "none" ]; then
		pr_json="\"pr\": { \"number\": ${SC_PR%%:*}, \"url\": \"https://github.com/krayong/ccsidekick/pull/${SC_PR%%:*}\", \"review_state\": \"${SC_PR##*:}\" },"
	fi
	# rate_limits drives Block/Weekly; a deployment card with an empty block/week omits it (no quota rows)
	local rl_json=""
	if [ -n "$SC_BLOCK" ] && [ -n "$SC_WEEK" ]; then
		rl_json=",
  \"rate_limits\": {
    \"five_hour\": { \"used_percentage\": $SC_BLOCK, \"resets_at\": $FIVE_H_AT },
    \"seven_day\": { \"used_percentage\": $SC_WEEK, \"resets_at\": $SEVEN_D_AT }
  }"
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
  "context_window": { "used_percentage": $SC_CTX, "total_input_tokens": $(( SC_CTX * 10000 )), "context_window_size": 1000000 }$rl_json
}
JSON

	# seed the mood event (unless idle)
	if [ "$SC_EVTOOL" != "none" ] && [ -n "$SC_EVTOOL" ]; then
		local so="" se=""
		[ "$SC_EVOK" = "fail" ] && se="1 fail FAIL" || so="ok pass"
		printf '{"hook_event_name":"PostToolUse","session_id":"sess-demo","tool_name":"%s","tool_input":{"command":"%s"},"tool_response":{"stdout":"%s","stderr":"%s"}}' \
			"$SC_EVTOOL" "$SC_EVCMD" "$so" "$se" | CLAUDE_CONFIG_DIR="$CFG" node "$BIN" classify >/dev/null 2>&1 || true
	fi

	# Render to raw ANSI (paths prettified). Deployment cards run in an isolated env so this shell's own
	# ANTHROPIC_*/CLAUDE_CODE_* can't mislabel the provider badge. The SVG is generated later, at a uniform size.
	if [ "${CARD_MODE:-normal}" = normal ]; then
		CLAUDE_CONFIG_DIR="$CFG" COLUMNS="$COLS" node "$BIN" render < "$W/payload.json" \
			| sed "s#/private$REPO#~/dev/ccsidekick#g; s#$REPO#~/dev/ccsidekick#g" > "$ansiout"
	else
		env -i PATH="$PATH" HOME="$HOME" LANG="${LANG:-en_US.UTF-8}" CLAUDE_CONFIG_DIR="$CFG" COLUMNS="$COLS" ${provider_env} \
			node "$BIN" render < "$W/payload.json" \
			| sed "s#/private$REPO#~/dev/ccsidekick#g; s#$REPO#~/dev/ccsidekick#g" > "$ansiout"
	fi
	rm -rf "$W"
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- pass 1: render every card's ANSI, and find the widest/tallest so all cards can share one geometry --
titles=(); i=0
for pack in "${PACKS[@]}"; do
	# +1 offset so the lead card (spiderman) lands on a full state (PR + 💡 tip + dirty git), not the sparse one
	apply_scenario "$(( (i + 1) % NSCEN ))"; CARD_MODE="$SC_MODE"
	render_card "$pack" "$TMP/$(printf '%03d' "$i").ansi"
	titles+=("$(pack_title "$pack") — ccsidekick")
	i=$((i + 1))
done
unset CARD_MODE
N=$i
echo "rendered $N fresh cards"

maxW=0; maxH=0
for ((k = 0; k < N; k++)); do
	SVG_RADIUS=0 bun "$SVG" "${titles[$k]}" < "$TMP/$(printf '%03d' "$k").ansi" > "$TMP/probe.svg"
	w=$(grep -m1 -oE 'width="[0-9]+"' "$TMP/probe.svg" | grep -oE '[0-9]+')
	h=$(grep -m1 -oE 'height="[0-9]+"' "$TMP/probe.svg" | grep -oE '[0-9]+')
	[ "$w" -gt "$maxW" ] && maxW=$w; [ "$h" -gt "$maxH" ] && maxH=$h
done
# invert the W/H formulas to the column/row counts that produce the widest/tallest card
MIN_COLS=$(awk "BEGIN{printf \"%d\", (($maxW - 2*$PAD)/$CELL_W)+0.999}")
MIN_ROWS=$(awk "BEGIN{printf \"%d\", (($maxH - $TITLEBAR - 2*$PAD)/$LINE_H)+0.999}")

# --- pass 2: regenerate each card at the uniform size and screenshot (full-width title bar on every card) --
mkdir -p "$TMP/cards"
for ((k = 0; k < N; k++)); do
	kk=$(printf '%03d' "$k")
	SVG_RADIUS=0 SVG_MIN_COLS="$MIN_COLS" SVG_MIN_ROWS="$MIN_ROWS" bun "$SVG" "${titles[$k]}" < "$TMP/$kk.ansi" > "$TMP/$kk.svg"
	W=$(grep -m1 -oE 'width="[0-9]+"' "$TMP/$kk.svg" | grep -oE '[0-9]+')
	H=$(grep -m1 -oE 'height="[0-9]+"' "$TMP/$kk.svg" | grep -oE '[0-9]+')
	"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor="$SCALE" \
		--window-size="${W},${H}" --default-background-color=0d1117ff --screenshot="$TMP/cards/$kk.png" "file://$TMP/$kk.svg" >/dev/null 2>&1
done

# --- og frame (wordmark + tagline + panel + footer), 2x, for the branded showcase ------------------------
WM="$(base64 -i "$WORDMARK" | tr -d '\n')"
cat > "$TMP/frame.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="640" viewBox="0 0 1280 640" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5fafff"/><stop offset="0.34" stop-color="#64d760"/><stop offset="0.67" stop-color="#ffd687"/><stop offset="1" stop-color="#ff8c87"/></linearGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="22" flood-color="#000000" flood-opacity="0.6"/></filter></defs>
  <rect width="1280" height="640" fill="#0b0e14"/>
  <image x="60" y="52" width="392" height="70" xlink:href="data:image/svg+xml;base64,$WM"/>
  <rect x="60" y="134" width="356" height="3" rx="1.5" fill="url(#g)"/>
  <text x="60" y="184" font-size="28" fill="#93a1b3">A Claude Code status line with a character that reacts.</text>
  <rect x="60" y="250" width="1160" height="234" rx="12" fill="#0d1117" stroke="#3a475b" stroke-width="1.5" filter="url(#sh)"/>
  <text x="60" y="577" font-size="18" fill="#7d899b">18 characters · 75+ themes · 33 widgets · zero token spend · local-first · MIT</text>
</svg>
SVG
rsvg-convert -w 2560 -h 1280 "$TMP/frame.svg" -o "$TMP/frame.png"

mkdir -p "$TMP/og"
for ((k = 0; k < N; k++)); do
	kk=$(printf '%03d' "$k")
	# fit the statusline into the panel (top-aligned; card bg == panel color so any slack is invisible)
	magick "$TMP/frame.png" \( "$TMP/cards/$kk.png" -resize 2320x468 \) -gravity NorthWest -geometry +120+500 \
		-composite -filter Lanczos -resize 1280x640 -strip "$TMP/og/$kk.png"
done

# --- shared assembly: crisp xfade MP4, and a small per-frame-palette morph GIF ---------------------------
even() { awk "BEGIN{printf \"%d\", int($1/2)*2}"; }

build_mp4() {  # <dir> <out>
	local dir="$1" out="$2" inputs=() filter="" step prev off
	step=$(awk "BEGIN{print $HOLD-$XFADE}")
	local d0; d0=$(magick identify -format '%wx%h' "$dir/000.png")
	local ew eh; ew=$(even "${d0%x*}"); eh=$(even "${d0#*x}")
	for ((k = 0; k < N; k++)); do
		inputs+=(-loop 1 -t "$HOLD" -i "$dir/$(printf '%03d' "$k").png")
		filter+="[$k:v]scale=$ew:$eh,fps=$FPS,format=rgba,setsar=1[v$k];"
	done
	prev="[v0]"
	for ((k = 1; k < N; k++)); do
		off=$(awk "BEGIN{printf \"%.3f\", $k*$step}")
		filter+="${prev}[v$k]xfade=transition=fade:duration=$XFADE:offset=$off[x$k];"; prev="[x$k]"
	done
	filter+="${prev}format=yuv420p[out]"
	ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" -map "[out]" \
		-c:v libx264 -preset slow -crf 18 -movflags +faststart "$out"
}

build_gif() {  # <dir> <out> <width>
	local dir="$1" out="$2" gw="$3" seq="$TMP/seq" list=() args=()
	rm -rf "$seq"; mkdir -p "$seq"
	for ((k = 0; k < N; k++)); do list+=("$dir/$(printf '%03d' "$k").png"); done
	# short cross-dissolves between held cards; scale down first to cap size
	magick "${list[@]}" -resize "${gw}x>" -morph "$MORPH" "$seq/f_%04d.png"
	local tot=$(( N + (N - 1) * MORPH )) step=$(( MORPH + 1 ))
	for ((f = 0; f < tot; f++)); do
		if (( f % step == 0 )); then args+=( -delay "$GIF_HOLD" "$seq/$(printf 'f_%04d' "$f").png" )
		else args+=( -delay "$GIF_XF" "$seq/$(printf 'f_%04d' "$f").png" ); fi
	done
	magick -loop 0 "${args[@]}" -dither None -layers optimize "$out"
}

sz() { echo "$(( $(stat -f%z "$1" 2>/dev/null || stat -c%s "$1") / 1048576 ))MB"; }

mkdir -p "$(dirname "$OUT")" "$(dirname "$SHOW_OUT")"
build_mp4 "$TMP/cards" "$OUT";        echo "wrote $OUT  ($N cards, $(sz "$OUT"))"
build_gif "$TMP/cards" "$GIF" "$GIF_W";        echo "wrote $GIF  (${GIF_W}px, $(sz "$GIF"))"
build_mp4 "$TMP/og"    "$SHOW_OUT";   echo "wrote $SHOW_OUT  ($N cards, $(sz "$SHOW_OUT"))"
build_gif "$TMP/og"    "$SHOW_GIF" "$SHOW_GIF_W"; echo "wrote $SHOW_GIF  (${SHOW_GIF_W}px, $(sz "$SHOW_GIF"))"
