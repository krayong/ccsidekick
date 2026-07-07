# ccsidekick

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
