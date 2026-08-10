---
description: "Install and wire the ccsidekick status line, with any of its character, theme, cost, comment, or widget settings"
argument-hint: "[what you want, in plain words]"
allowed-tools: Bash(npx -y ccsidekick:*)
---

# Install ccsidekick

Set up the ccsidekick status line for this user. What they asked for, if anything: "$ARGUMENTS"

## Steps

1. **Find out what is available.** Run these and read the output. They are the only source of valid values:

    ```bash
    npx -y ccsidekick list characters
    npx -y ccsidekick list themes
    npx -y ccsidekick list widgets
    npx -y ccsidekick setup --help
    ```

2. **Work out which settings they asked for.** Treat `$ARGUMENTS` as a description of intent, not as text to
   paste into a command. Map it onto the flags below, taking every value verbatim from the `list` output. If
   something they named is in none of the lists, say so, show the closest matches, and ask. Never pass through
   a value that failed to match.

    | They want                     | Flag                     | Notes                                          |
    | ----------------------------- | ------------------------ | ---------------------------------------------- |
    | a specific character          | `--character=<name>`     | implies fixed mode on its own                  |
    | to rotate characters          | `--mode=random`          | the default; pairs with `--roster`             |
    | to rotate a chosen few        | `--roster=<a,b,c>`       | needs `--mode=random` to take effect           |
    | one character pinned          | `--mode=fixed`           | uses `--character`, or `spiderman` by default  |
    | a colour scheme               | `--theme=<name>`         | `character` means "match the active character" |
    | costs in their currency       | `--currency=<CODE>`      | e.g. `USD`, `EUR`, `INR`                       |
    | a monthly spend budget        | `--budget=<usd>`         | a number, `0` or more                          |
    | the character to stop talking | `--comments=off`         | `on` to restore                                |
    | the tip line gone             | `--helpful=off`          | `on` to restore                                |
    | fewer, more urgent tips       | `--min-severity=<level>` | `low`/`medium`/`high`/`critical`               |
    | a specific set of widgets     | `--widgets=<a,b,c>`      | see the warning below                          |
    | per-project config            | `--local`                | default is `--global`                          |

    If `$ARGUMENTS` is empty, pass no flags at all. The defaults are random mode over the whole roster with a
    matching theme, which is a good first experience.

3. **Two flags need care before you use them.**

    **`--widgets` replaces, it does not add.** Every widget you leave out is turned off. If they asked to "add
    the PR widget", read their current set from
    `${CLAUDE_CONFIG_DIR:-~/.claude}/ccsidekick/config.toml` first and pass that set plus the new one. Passing
    `--widgets=pr` alone would leave them with a status line containing nothing but a PR field. If you cannot
    read their current set, say so and ask rather than guessing.

    **`--usage-fetch=on` turns on a network call.** It is off by default. Enabling it makes ccsidekick send the
    user's OAuth token to Anthropic to read account usage, which the `pay_as_you_go` and limit widgets need. It
    spends no model tokens, but it is a credentialed request leaving their machine. Only pass it if they asked
    for account-usage or pay-as-you-go information, tell them plainly what it does, and get a yes first.

4. **Run the installer.** With nothing specified:

    ```bash
    npx -y ccsidekick setup
    ```

    With settings, all in one invocation:

    ```bash
    npx -y ccsidekick setup --character=batman --theme=batman --currency=INR --budget=50
    ```

    Only the flags you pass are applied; every other setting keeps its current value, so this is safe to
    re-run. An invalid value exits non-zero and prints the valid set, so read stderr before retrying rather
    than guessing again.

5. **Report back.** Tell them:
    - what was configured, quoting the installer's own summary line;
    - **that they need to restart Claude Code before the status line appears**, because `settings.json` is
      read at startup;
    - that config lives at `${CLAUDE_CONFIG_DIR:-~/.claude}/ccsidekick/config.toml` and is hand-editable;
    - that `npx ccsidekick` opens the full setup UI, which also shows cross-session stats;
    - that `npx ccsidekick uninstall` reverses everything.

## What this command cannot set

Some config has no `setup` flag and is reachable only through the TUI (`npx ccsidekick`) or by hand-editing
`config.toml`. If they ask for one of these, say so and point them at the TUI instead of improvising a flag:

- `[network] fx_refresh`, the optional weekly currency-rate refresh.
- `[network] balance_path`, a custom balance file.
- `[theme] banding`, `[theme] mood_shift`, `[theme] icons`: hue banding, mood re-tinting, custom icons.

## Rules

- Never pass `--config-dir`. It has no path validation and redirects where `settings.json` and `config.toml`
  are written. If they genuinely need a non-default config directory, tell them to set `CLAUDE_CONFIG_DIR` in
  their environment, or to run `npx ccsidekick setup --config-dir=<path>` themselves.
- Never build a command by interpolating `$ARGUMENTS` into it. Choose each value yourself from the enumerated
  lists and pass it as `--flag=value`.
- Every character registers a theme under its own name, so a word like `batman` appears in both the character
  and theme lists. When that happens, set both flags to it rather than picking one.
- Never hand-edit `settings.json`. The installer backs the file up, merges, and verifies the write; a manual
  edit skips all of that.
- If `npx` fails because Node is too old, say so plainly: ccsidekick needs Node 20.6 or newer.
