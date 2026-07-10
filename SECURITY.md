# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately through
GitHub's [private vulnerability reporting](https://github.com/krayong/ccsidekick/security/advisories/new),
or email **ccsidekick@krayong.com**. Include steps to reproduce and the affected version or commit.
You will get an acknowledgement, and we will work with you on a fix and a disclosure timeline.

## Security model

ccsidekick runs as a Claude Code status line and a tool-call hook. It reads the filesystem, edits
one settings file, and (through the setup TUI) drives the package manager. A few properties are
load-bearing.

### Packs are data, never executed code

A pack is a `pack.json` read as JSON. The loader reads it as data and never `require()`s pack code,
so no pack JavaScript ever reaches a load path. Every character is a first-party, data-only runtime
dependency bundled with the engine, so a fresh install already carries the whole catalog: there is
no install, browse, download, or auto-install path, no third-party source, and no lifecycle scripts
to run. A pack reaches a user only after it lands in this repo.

The allowlist gate validates the full package name, not just the prefix: a name is installable only
when it matches `@ccsidekick/pack-<name>` with `<name>` drawn from `^[a-z0-9-]+$`. Both
`npm install` and `import.meta.resolve` consume that segment, so a prefix-only check would pass
`@ccsidekick/pack-../../evil` and feed a path traversal straight through resolve.

### The pack validator rejects hostile JSON

Validation reads every known field by name. It runs no generic deep-merge or whole-object spread
that could smuggle attacker keys into engine objects, rejects the dangerous keys `__proto__`,
`constructor`, and `prototype` anywhere in the parsed data, and bounds array and string lengths (
4000 chars per string, 2000 entries per array, 64 frames per mood, 32 levels of nesting). The figure
box itself is capped at 9 rows by 25 columns.

### Terminal output is sanitized before it is colorized

Every externally sourced text value is stripped of all C0/C1 control bytes and ESC sequences before
the renderer colorizes it. That covers pack free text (the figure, the comment line, the emblem, the
pack name) and external value text the payload supplies (the cwd, `session_name`, `todo` content,
provider badges). Only the renderer's own SGR color codes are emitted, so a crafted pack or a
hostile directory name cannot inject escape sequences, move the cursor, or repaint the terminal.

### Tool command text is read, never stored

The classify hook reads a tool call's command text in process to classify it (test pass, build fail,
commit, and so on), then writes only a category and a millisecond timestamp to the session event
log. Raw command text is never persisted or stored, so the log accrues no sensitive data on disk.
The hook runs offline: no Claude API, no tokens, no telemetry. It always exits 0 and writes nothing
to stdout or stderr, so a malformed payload or a disk error never surfaces to Claude Code.

### Settings edits are validated, atomic, and reversible

`installSettings` refuses to touch a `settings.json` it cannot parse as a JSON object. Before any
change it writes one timestamped backup beside the file, keeping the oldest (the user's pre-install
original) and the newest and dropping the rest. It writes atomically (temp + rename), re-reads the
result to confirm it still parses, and restores the prior content on a verify failure, so a user's
`settings.json` is never left broken. An existing `statusLine` is replaced only with explicit
consent.

`uninstall` reverses the wiring by key, preserving later edits. It always removes our three classify
hook entries while keeping the user's own entries under the same event, and it removes `statusLine`
and `spinnerVerbs` only when their value is ours (the `statusLine` command points at our render
bin). A `statusLine` or `spinnerVerbs` the user set themselves is left intact. Restoring the newest
install backup is an opt-in path.

### Network use is narrow, off the hot path, and disableable

Two non-LLM lookups exist: a weekly currency-rate refresh and an opt-in OAuth account-usage call.
Both run detached from the render tick, both can be turned off in `[network]`, and neither blocks a
status line. A refreshed rate table is accepted only when every rate is a finite positive number; a
`NaN`, an `Infinity`, or a value at or below zero discards the whole refresh and leaves the cached
table in place. There is no network on the render or cost path.

### Secret scanning

The `pre-push` git hook runs trufflehog over the push when it is installed, and prints a loud
warning when it is absent so a contributor knows the local scan was skipped. CI runs trufflehog as
the authoritative gate and fails the build on a verified secret.

If you find a way to break any of these, that is exactly what we would like to hear about.
