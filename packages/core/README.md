# ccsidekick

A Claude Code status line with an animated, reactive character and a full widget layer. It reads
from disk, so there is no Claude API call and no token spend on the render path. The only network is
an optional weekly currency-rate refresh and an optional account-usage lookup, both off the render
path and disableable.

```bash
npx ccsidekick
```

Running `ccsidekick` in a terminal opens the setup TUI: it picks a Claude config dir, lets you choose
a character, and wires the status line and the tool-call hooks into your `settings.json`. Remove it
with `npx ccsidekick uninstall`.

## The two binaries

- **`ccsidekick-render`** is the hot path. Claude Code calls `ccsidekick-render render` on every
  status-line tick and `ccsidekick-render classify` on every tool call. It loads no UI and runs under
  plain Node.
- **`ccsidekick`** is the setup TUI and `uninstall`. It is the only entry point that loads the Ink
  interface.

Characters ship as separate `@ccsidekick/pack-<name>` packages; `batman` is bundled as a runtime
dependency so a fresh install always has a character.

For the full feature tour, configuration reference, and contributor docs, see the
[repository README](https://github.com/krayong/ccsidekick#readme).

Licensed under MIT.
