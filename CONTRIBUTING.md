# Contributing to ccsidekick

Thanks for your interest. ccsidekick is a Claude Code status line with a reactive ASCII character and a full
widget layer. Bug fixes, new widgets, and new character packs are all welcome.

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

The repo is a Bun workspace. The engine is `packages/core` (published as `ccsidekick`); each character is
`packages/packs/<name>` (published as `@ccsidekick/pack-<name>`).

```bash
bun install
bun test
```

`bun install` also points git at the repo's native hooks (`core.hooksPath = .githooks`). The `pre-commit` hook
runs Prettier, ESLint, the type-checker, and the test suite; the `pre-push` hook runs trufflehog when it is
installed.

## Toolchain

| command                | what it does                                        |
| ---------------------- | --------------------------------------------------- |
| `bun test`             | the test suite; the source of truth for correctness |
| `bun run typecheck`    | `tsc --noEmit`, strict and maximal-pedantic         |
| `bun run lint`         | ESLint (`strictTypeChecked`)                        |
| `bun run format:check` | Prettier in check mode (printWidth 100, tabs)       |
| `bun run format`       | Prettier in write mode                              |
| `bun run build`        | the two-bundle Bun build into `packages/core/dist`  |
| `bun run lint-pack`    | the pack gate (see below)                           |

The TypeScript config is strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax`, so loose access and implicit `any` are errors,
not warnings. Keep all four green; the `pre-commit` hook enforces them anyway.

## Conventions

- **TypeScript, ESM.** `"type": "module"`; never `require()` in shipped modules.
- **TDD.** Write the failing test first, watch it fail for the right reason, then the minimal implementation.
  Commit often.
- **Node-portable core.** The shipped library avoids Bun-only runtime APIs so it runs on Node; `bun:test` and
  `Bun.spawn` are test-only. Setup-time code (the TUI and the bundle build) may use Bun APIs.
- **Match the surrounding style.** Touch only what your change needs.
- **State facts, not plan history.** Comments and docs describe what the code does and why, never what some
  prior plan or phase said. Leave no pointers to scratch docs.

The load-bearing invariants (pack format, the transcript-derived cost engine, concurrency safety, the config
schema, the three-hook classifier, render-tick cost) are documented in [CLAUDE.md](CLAUDE.md). Read that before
changing the engine.

## Submitting a change

1. Fork and branch from `main`.
2. Make the change with a test. Run `bun test`, `bun run typecheck`, `bun run lint`, and `bun run format:check`,
   and confirm each is green and clean.
3. Open a pull request describing the change and how you verified it.
4. A maintainer reviews. CI runs the type-check, lint, format check, the test suite, the pack lint, the bundle
   build, a render smoke test, and a trufflehog scan on every PR.

## Contributing a character pack

A pack is **data, never code**: a `pack.json` with one figure, a message library, an `attribution`, and
at least 25 spinner verbs. The full authoring and sourcing contract lives in the `pack-author` skill
(`.claude/skills/pack-author`). In short:

- **Art is sourced, never freehand-drawn,** and every figure credits its original artist in `attribution`. Use
  the `ascii-art` image-to-ASCII skill, then hand-clean the result.
- The pack must pass `bun run lint-pack packages/packs/<name>`: the single 9×25 figure,
  the 620-line voice pool counts, the 25-verb spinner floor, near-duplicate detection, a legibility heuristic,
  and attribution.
- Generate the pack's `README.md` and its themed statusline shot, then commit both (the render binary
  must be built first): `bun run build && bun run pack-readme packages/packs/<name>`.

Add `<name>` to `FIRST_PARTY_PACKS` in `packages/core/src/packs/registry.ts` so the catalog and the parity test
see it.

## Reporting bugs and security issues

For bugs, open an issue with steps to reproduce. For security vulnerabilities, do **not** open a public issue;
see [SECURITY.md](SECURITY.md).
