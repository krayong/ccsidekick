# ccsidekick

A Claude Code status line with an animated, reactive character and a full widget layer. It reads
from disk, so there is no Claude API call and no token spend on the render path. The only network is
an optional weekly currency-rate refresh and an optional account-usage lookup, both off the render
path and disableable.

```bash
npx ccsidekick
```

Running `ccsidekick` in a terminal opens the setup UI: a first run walks you through a short guided
wizard (character, theme, comments), a later run opens the full dashboard. Either way it picks a
Claude config dir and wires the status line and the tool-call hooks into your `settings.json`.
Remove it with `npx ccsidekick uninstall`.

## Non-interactive setup (for scripts and AI agents)

No TTY required. `npx ccsidekick setup` configures and wires everything from flags, so an agent can
install it in one command:

```bash
npx ccsidekick setup --character spiderman --theme houston --mode fixed
```

Only the flags you pass are applied (a partial patch onto the existing config, or the defaults on a
fresh install), then it writes `config.toml` and wires `settings.json` exactly like the TUI.

| Flag                     | Sets                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `--character <name>`     | the fixed character                                             |
| `--mode <fixed\|random>` | fixed one character, or rotate the roster                       |
| `--roster <a,b,c>`       | the random-mode roster                                          |
| `--theme <name>`         | a theme, or `character` (the default) to match the character    |
| `--currency <code>`      | statusline currency, e.g. `USD`                                 |
| `--budget <usd>`         | monthly budget                                                  |
| `--comments <on\|off>`   | the character's comment line                                    |
| `--helpful <on\|off>`    | the helpful-tip line                                            |
| `--min-severity <sev>`   | `low\|medium\|high\|critical`                                   |
| `--widgets <a,b,c>`      | statusline widgets to enable (others turn off)                  |
| `--global` / `--local`   | save target (default global)                                    |
| `--config-dir <path>`    | Claude config dir (default `$CLAUDE_CONFIG_DIR` or `~/.claude`) |

Discover valid values for scripting, and see every flag:

```bash
npx ccsidekick list characters # also: themes, widgets
npx ccsidekick setup --help

```

An unknown value (e.g. a misspelled theme) exits non-zero and prints the valid set — it never
silently falls back.

## The two binaries

- **`ccsidekick-render`** is the hot path. Claude Code calls `ccsidekick-render render` on every
  status-line tick and `ccsidekick-render classify` on every tool call. It loads no UI and runs
  under plain Node.
- **`ccsidekick`** is the user-facing entry: the setup UI, plus `setup`, `list`, and `uninstall`.
  Only the TUI loads the Ink interface; `setup`/`list`/`uninstall` run under plain Node.

Every character ships bundled as a runtime dependency, so a fresh install has them all — there is no
download or install step, and no network to pick a character.

For the full feature tour, configuration reference, and contributor docs, see the
[repository README](https://github.com/krayong/ccsidekick#readme).

Licensed under MIT.
