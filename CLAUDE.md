# CLAUDE.md

Guidance for working on ccsidekick: a Claude Code status line with an animated, reactive character
and a full widget layer. No Claude API, no token spend. Network use is limited to non-LLM lookups (
an
optional weekly currency-rate refresh and an optional account-usage call, both off by default), off
the hot render path and enabled only when you turn them on.

## Architecture

A Bun workspace. The workspace root is `ccsidekick-workspace` (private). The engine is
`packages/core` (published as `ccsidekick`); each character is `packages/packs/<name>` (published as
`@ccsidekick/pack-<name>`).

Core source lives under `packages/core/src/` and follows the render pipeline, acquire → derive →
compose → render → persist:

- `domain`: shared types, enums, and tuned constants.
- `format`: pure formatting helpers (widths, number/duration/cost formatting).
- `sources` (acquire): payload, config, git, transcripts, fx, usage, clock, plus `sources/storage` (
  atomic writes and locks). Side-effecting reads live here.
- `derived` (derive): the classifier, the cost/pricing engine, and cross-session analytics.
- `compose` (compose): the statusline field set, the character line, and `compose/helpful` tips.
- `render` (render): layout, ANSI color, control-char stripping, width measurement.
- `packs`: the pack loader, validator, allowlist, registry, lint, and preview.
- `cli`: the render/classify/settings/uninstall/setup command logic (no UI).
- `tui`: the Ink setup UI and `tui/sections`.
- `web`: the browser render entry and Node-API shims that let the render pipeline run in-browser for
  the landing-page live demo (not shipped to npm).
- `bin`: the two executables.

```
Claude Code ──stdin JSON──▶  ccsidekick-render render  ──stdout ANSI──▶  status line (main agent only)
                                      ▲
three PostToolUse-family hooks ──ccsidekick-render classify──▶  events log + state  (disk only, no API, no tokens)
```

### Two binaries

- **`ccsidekick-render`** is the lean hot path. It carries the `render` and `classify` subcommands,
  pulls in no Ink or React, and runs under plain Node. Claude Code spawns it on every statusline
  tick and every tool call.
- **`ccsidekick`** is the user-facing entry. A bare invocation in a TTY launches the Ink setup UI (a
  first run — no `config.toml` yet — shows the guided wizard; a returning user gets the dashboard).
  `setup [flags]` configures and wires non-interactively (no Ink),`list <characters|themes|widgets>`
  prints valid values, and `uninstall` reverses the wiring. The TUI is the one place outside
  `tui/**` that may load Ink/React, and the bin imports it lazily so `setup`/`list`/`uninstall`
  never pull in the UI runtime.

State lives under `~/.claude/ccsidekick/` (honoring `CLAUDE_CONFIG_DIR`), partitioned per session
under `sessions/<id>/`. The cross-session analytics store (`analytics/`) and the per-file cost cache
are lock-guarded.

## Load-bearing invariants

- **Pack art is a single 9×25 figure:** `art: readonly string[]` — one figure, its rows, keyed by
  nothing. There is no per-mood or multi-frame art; `pack.art` is read directly. Mood adds
  color-only effects (pulse/brighten/tint) that never shift a glyph, so the figure cannot strobe.
- **Figure box is fixed and lint-enforced:** the figure is at most 9 rows × 25 columns; an
  over-budget figure fails `pack:lint`. That authoring gate is separate from the render-time drop:
  below `MIN_RIGHT_WIDTH` the figure is dropped entirely and the statusline leads with a pack chip.
- **Packs are data, never executed code, and every pack is bundled.** The loader reads `pack.json`
  as JSON and never `require()`s pack code. Every pack ships with the engine as a runtime dependency
  (declared in `packages/core/package.json` and listed in `PACKS`), so a fresh install has every
  character; there is no install, browse, or download path. The default config runs random mode over
  the whole roster (empty `roster`); `spiderman` is only the fixed-mode default `name`. The
  loader still validates a pack name's segment (`allowlist.ts`) before resolving it, guarding
  `import.meta.resolve` against path traversal. A new pack is added by dropping it in
  `packages/packs/<name>` (passing `pack:lint`) and registering it in `PACKS`.
- **Art is sourced, never hand-drawn,** through the `ascii-art` image-to-ASCII skill, and every
  figure credits its artist in `attribution`.
- **Config is exactly** (tables in dashboard-section order): `schema_version`, then `[character]`
  (enabled, mode, name default `spiderman`, roster), `[theme]` (`name` default `character` — the
  Match
  Character sentinel that resolves each surface to the active pack's own theme, falling back to
  `houston` — optional per-surface `statusline`/`logo`/`comment`, `banding` default `solid`,
  `mood_shift`, `icons`), `[comments]` (`character`, `helpful`, `min_severity` — the Comments
  section's two on/off streams plus the tip severity floor), `[network]` (fx_refresh, usage_fetch,
  balance_path), `[statusline]` (currency, optional `budget`, per-widget `widgets` toggles). The
  cost cache TTL (5000ms) and the statusline refresh interval (1s) are hardcoded constants, not
  config; git runs fresh every tick.
- **Theme is catalog data + per-pack data; engine logic**: the built-in catalog (`data/themes.ts`)
  holds named `ThemeData` entries; a pack ships an optional `theme` block (same shape, minus
  `displayName`) that registers under the pack's name as a selectable theme. The cell separator is
  always `│`; signal colors are `nominal/caution/critical`; threshold bands are fixed. The figure is
  theme-painted via the logo theme's shimmer gradient (packs ship no `colors`, `palette`, or
  `colorMaps`). All coloring algorithms live in core, so packs stay pure data.
- **Cost is transcript-derived in-house, never Claude Code's stored cost**: Chat, Project (keyed by
  the **Project** term) and Total are all token-priced scans of Claude Code transcripts, deduped
  **globally across the whole tree** by `(message.id, requestId)`, behind a per-file
  `{mtime, size, byteOffset, headHash, …}` cache. The active transcript grows every tick, so a changed
  file re-prices only its appended tail (resuming from `byteOffset`, the end of the last complete line)
  and folds it into the cached entry, byte-identically to a full parse; a compaction rewrite (head-hash
  mismatch) or truncation falls back to a full reparse. Claude Code's payload `cost.total_cost_usd` double-counts replayed
  context on resumed sessions, so it is never a Total/Project source — it (and the persisted
  authoritative cost) is only a first-tick fallback for the current session's Chat, before the tree
  scan reaches its transcript. The Stats board attributes each globally-deduped line directly to its
  own file's session at dedup time (one record per session, summed from `aggregate.tokenPriced`, not
  the per-file totals — summing those would re-count overlapping replayed history), so cross-file
  replay never double-counts. No external usage-tool subprocess, no network on the cost path.
- **State is concurrency-safe:** atomic write-tmp-rename, `O_EXCL` locks with a read-only fallback.
  Session identity prefers `session_id`, then a sha1 of `transcript_path`.
- **Character voice is pack-owned**: each pack declares `tone` (mild/edgy/offensive). The comment
  always renders when `[comments].enabled` (selection walks a priority chain and falls through to an
  idle line), and is omitted only when disabled or the pack ships no usable voice. There is no user
  verbosity or edgy config.
- **The classifier is two-hook and soft-failing**: the same `ccsidekick-render classify` command is
  wired into the per-call `PostToolUse` and `PostToolUseFailure` hooks. `PostToolBatch` is
  deliberately not wired — it co-fires with the per-call hooks, so classifying it too would
  double-count every event — and its payload (no top-level `tool_name`) falls through to a no-op if
  present; `uninstall` still strips any legacy `PostToolBatch` entry. `PostToolUseFailure` is a hard
  fail; a `PostToolUse` success flips to a failure when the `tool_response` shows `isError`,
  `interrupted`, or a `FAIL_RE` match over the combined `stdout`+`stderr`. A non-empty `stderr` is
  not itself a fail signal (many toolchains write progress and warnings to stderr on success), so a
  failure must be evidenced by a `FAIL_RE` marker. The hook reads tool command text in process to
  classify it, never persists or stores it, and always exits 0 writing nothing to stdout or stderr.
- The shipped core avoids Bun-only runtime APIs so it stays Node-portable; `bun:test` is test-only.
  Setup-time code (the TUI and the bundle build) may use Bun APIs (e.g. `Bun.build`).

## Conventions

- **TDD:** failing test first, then the minimal implementation, frequent commits.
- **TypeScript, ESM** (`"type": "module"`); never `require()` in shipped modules.
- **Maximal-pedantic toolchain:** `tsc` runs strict with `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`; ESLint runs `strictTypeChecked`; Prettier
  owns formatting (printWidth 100, tabs). Native `.githooks` (`git config core.hooksPath .githooks`,
  set by `bun install`) gate commits and pushes.
- Match the surrounding code's style.

## Commands

Run from the workspace root (a Bun workspace):

| Command                                   | What it does                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun test`                                | The whole suite (`bun:test`).                                                            |
| `bun run typecheck`                       | `tsc` strict, both project configs (src, then tests/scripts/tui).                        |
| `bun run lint`                            | ESLint `strictTypeChecked` over the workspace.                                           |
| `bun run format` / `bun run format:check` | Prettier write / check.                                                                  |
| `bun run build`                           | Bundle both bins into `packages/core/dist/`.                                             |
| `bun run pack:lint <dir>`                 | Validate a pack (schema, figure box, pool counts, width, verbs, near-dups).              |
| `bun run pricing:check`                   | Verify the bundled pricing map covers current models.                                    |
| `bun run site:build`                      | Rebuild the landing page under `website/` (tokens, data, and the browser render bundle). |

`bun install` wires the native `.githooks` (pre-commit: format/lint/typecheck/test; pre-push: secret
scan).

## No Stale Plan References

**IMPORTANT:** After any refactor or new feature, do NOT leave references in code or markdown to
what the plan was — no "per the plan", no "according to decision N", no plan phase or task numbers,
no pointer to the planning or design doc. Those planning docs are scratch that won't survive, so a
citation to them becomes a stale, dangling reference the moment they're deleted. State the fact or
rule directly; if a decision's rationale matters, write the rationale itself, not a pointer to where
it was decided.
