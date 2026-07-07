---
"ccsidekick": minor
---

Bundle every character pack, add a guided first-run wizard and a non-interactive `setup` CLI, and restructure `config.toml` to mirror the dashboard.

- **Packs are bundled.** Every character now ships as a runtime dependency, so a fresh install has them all. The on-demand install/browse path is gone (fixing the roster showing uninstalled characters and the install-then-reset-to-batman failure).
- **Guided setup.** A first run opens a wizard (Character → Theme → Comments → Review); a returning user opens the dashboard; Ctrl+W / Ctrl+D switch between them.
- **Non-interactive CLI.** `ccsidekick setup [flags]` configures and wires `settings.json` without the TUI, and `ccsidekick list characters|themes|widgets` prints valid values.
- **Match Character** is the new default theme; the wordmark flicker on iTerm2/Terminal.app is fixed.

**BREAKING** — `config.toml` is restructured with no backward-compat. Tables are reordered to match the dashboard sections, `[helpful]` folds into `[comments]` (`character` / `helpful` / `min_severity`), and `[line]` is renamed `[statusline]`. Existing configs should be re-created (re-run `ccsidekick`, or edit by hand).
