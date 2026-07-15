# ccsidekick

## 1.6.2

### Patch Changes

- bb4e1e3: Fix the incremental cost-scan resume to carry a session's time bounds exactly as a full parse does.

    - `record.end` now advances from every appended line, not just usage-bearing ones. A tick landing on the common mid-turn state (a trailing user or tool line logged after the last assistant message) no longer leaves the session end frozen at the last assistant timestamp, so session duration and recency read correctly instead of lagging by up to a turn.
    - `record.start` is now widened symmetrically. A resumed session opening with an undated `summary` line (start clamped to 0) no longer keeps that clamp after dated lines are appended, fixing a "working since 1970" collapse in the tenure and streak display.

## 1.6.1

### Patch Changes

- 7149b81: Helpful-comment tuning and a git fix.

    - The `no_upstream` tip no longer fires once a branch is already on the remote. A branch pushed without `-u` has no configured upstream but does have a local `origin/<branch>` ref, and the tip now checks that ref (a local lookup, never a network call) before nagging.
    - The default comment floor `[comments].min_severity` is now `medium`. `detached_head` and `effort_low` move up to medium so they still show at that floor; `pay_as_you_go_active` moves down to low.
    - Reworded the compaction tip. A compact summarizes the conversation, not the working tree, so uncommitted files survive it. It now reads "Commit now while the context is fresh."

## 1.6.0

### Minor Changes

- 03b8adf: Add a `--usage-fetch <on|off>` flag to `ccsidekick setup`, so the account-usage lookup can be enabled non-interactively (it writes `[network].usage_fetch`). This is the one data source the pay-as-you-go widget needs, since its numbers come only from the account and cannot be derived from local transcripts. Everything else stays off by default.

## 1.5.0

### Minor Changes

- 9456bd5: Network lookups are now off by default. `usage_fetch` (the OAuth account-usage widget, which sends your Anthropic token to Anthropic's account-usage endpoint) and `fx_refresh` (the weekly currency-rate refresh) both default to `false`. Enable either under `[network]` if you want it. Out of the box ccsidekick now makes no network calls at all, so it is local-first by default and both lookups are opt-in.

## 1.4.0

### Minor Changes

- 56ef17c: Project cost keeps matching after a mid-session `cd` into a subdirectory: it now keys off the session transcript's directory rather than the live working directory. The default character is now Spider-Man. Adds an in-browser build of the render pipeline that powers the landing-page live demo (not shipped in the npm package).

## 1.3.0

### Minor Changes

- a8557c3: Spread `random` character assignment by least-recently-used. A new session now picks the character
  whose most recent use across sessions is oldest (a never-used one wins outright), and only breaks
  ties within that group by the existing session-id hash. History is tracked with a per-session
  `updatedMs` stamp on the attribution store; legacy rows without it read as long-ago and re-stamp on
  next use, so no migration is needed. A fresh install has no history and every candidate ties, so the
  first sessions still fall through to the hash pick — the spreading builds up as history accumulates.

    Refresh the theme catalog. Drop the 13 light-background themes, which read muddy on a dark terminal,
    leaving 57 dark and high-contrast entries; a config that names a removed theme falls back to the
    default. Recolor a dozen dark themes whose palettes had collided so each reads distinctly (material
    and palenight were identical, as were VS Code Dark+ and its high-contrast twin, alongside near-dupes
    across the Material, Tokyo, Nord, and GitHub families). Brighten the last few dim accent and signal
    stops in Solarized Dark, Darcula, Rosé Pine, and Kanagawa so nothing looks washed out.

### Patch Changes

- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
- Updated dependencies [a8557c3]
    - @ccsidekick/pack-ben10@1.0.0
    - @ccsidekick/pack-darth-vader@1.0.0
    - @ccsidekick/pack-gandalf@1.0.0
    - @ccsidekick/pack-iron-man@1.0.0
    - @ccsidekick/pack-joker@1.0.1
    - @ccsidekick/pack-naruto@1.0.0
    - @ccsidekick/pack-pikachu@1.0.1
    - @ccsidekick/pack-sherlock-holmes@1.0.1
    - @ccsidekick/pack-shinchan@1.0.0
    - @ccsidekick/pack-superman@1.0.0
    - @ccsidekick/pack-yoda@1.0.0

## 1.2.0

### Minor Changes

- 731d73e: Resolve the random-pick candidate set from the bundled pack registry instead of scanning the filesystem for installed packs. Every pack ships with the engine, so the on-disk `installed`/`engineRoot` scan is gone from the render and save paths.

    A persisted character pick is now revalidated against the current config before it sticks: in `fixed` mode it must equal the configured name, in `random` mode it must still be a candidate. Narrowing the roster now evicts a dropped character instead of letting the stale pick persist.

    Fix a narrow-terminal overflow: when the dropped-figure `[name]` chip is wide (a long character name), the statusline no longer runs one column past its budget. Truncation now cascades from the tail across cells, so a protected field shrinks rather than pushing the row past the edge.

### Patch Changes

- Updated dependencies [731d73e]
    - @ccsidekick/pack-joker@1.0.0
    - @ccsidekick/pack-pikachu@1.0.0
    - @ccsidekick/pack-sherlock-holmes@1.0.0

## 1.1.0

### Minor Changes

- ad4967d: Bundle every character pack, add a guided first-run wizard and a non-interactive `setup` CLI, and restructure `config.toml` to mirror the dashboard.

    - **Packs are bundled.** Every character now ships as a runtime dependency, so a fresh install has them all. The on-demand install/browse path is gone (fixing the roster showing uninstalled characters and the install-then-reset-to-batman failure).
    - **Guided setup.** A first run opens a wizard (Character → Theme → Comments → Review); a returning user opens the dashboard; Ctrl+W / Ctrl+D switch between them.
    - **Non-interactive CLI.** `ccsidekick setup [flags]` configures and wires `settings.json` without the TUI, and `ccsidekick list characters|themes|widgets` prints valid values.
    - **Match Character** is the new default theme; the wordmark flicker on iTerm2/Terminal.app is fixed.

    **BREAKING** — `config.toml` is restructured with no backward-compat. Tables are reordered to match the dashboard sections, `[helpful]` folds into `[comments]` (`character` / `helpful` / `min_severity`), and `[line]` is renamed `[statusline]`. Existing configs should be re-created (re-run `ccsidekick`, or edit by hand).

## 1.0.0

### Major Changes

- e12c6c2: Initial public release.

### Patch Changes

- Updated dependencies [e12c6c2]
    - @ccsidekick/pack-batman@1.0.0
