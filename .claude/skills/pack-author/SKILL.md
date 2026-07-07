---
name: pack-author
description: Author a new ccsidekick character pack end-to-end - source the figure, pick a theme, write 620 voice lines and 25 spinner verbs, then ship through lint, a generated README, and an autonomous review. Use when creating, building, or scaffolding a ccsidekick character pack.
---

# Authoring a ccsidekick character pack

A pack is data: one `pack.json` and a `package.json`, never executed code. The engine reads it;
nothing in a pack runs. All constraints are enforced by `lint-pack`. This skill drives the authoring
loop to a hard finish.

## Prerequisite

The skill scripts run under `bun`. Confirm it is on `PATH` before starting:

```
bun --version
```

Both Claude Code and Codex CLIs spawn a shell, but `bun` is not guaranteed in a Codex environment.
If it is absent, none of the skill scripts will run.

## Terminal state

The pack is done when all four conditions hold:

1. `bun run lint-pack packages/packs/<name>` exits 0: schema guard, placeholder gate, cross-cell
   gate, pool counts, 66-column width, spinner-verb floor, near-duplicate threshold, and legibility.
2. `bun test packages/core/src/packs/registry.test.ts` passes.
3. Every user-approval gate in the stages below is cleared.
4. The user has approved the final `pack.json`.

Lint passing is necessary, not sufficient. It passes on placeholder text, so a green lint does not
certify voice or art. User approval (gates 3 and 4) is the binding quality check.

## Stage 1: Figure

The figure is a single static array of at most **9 rows × 25 columns**. Mood changes engine-applied
color only: no per-mood art, no glyph shifts.

**1. Scaffold the pack first** (skip if the directory already exists):

```
bun .claude/skills/pack-author/scripts/scaffold.ts <name> --display "<DisplayName>" --emblem "<glyph>"
```

Creates `packages/packs/<name>/` with a skeleton `pack.json` (every pool keyed, one unique
placeholder per leaf cell), a `package.json`, a `README.md`, and a `REVIEW.md`. Registers `<name>`
in `PACKS` and links it as a `workspace:*` runtime dependency of `packages/core` (every pack ships
bundled), both idempotently; re-running the scaffold overwrites the skeleton files and leaves an
existing registry entry and dependency untouched.

**2. Install the workspace link.** Run `bun install` from the workspace root. The render loader
resolves each pack through `packages/core/node_modules/@ccsidekick/pack-<name>`, which the workspace
only
materializes for the declared core dependency the scaffold just added. Skip this and the pack fails
to load at render time: the statusline shot (Stage 7) silently drops the figure and leads with the
chip. This is a one-time step per pack.

**3. Ask the user** whether they have a reference image, a specific ASCII or braille art source, or
want generated candidates.

**4. Generate five candidates.** Art is sourced through tooling, never hand-drawn:

- Use the **`ascii-art` skill** to convert a reference image to ASCII, then hand-clean it: fix
  ragged rows, thin the density, drop stray glyphs. Set `attribution.artist` and
  `attribution.source` to the image credit.
- For braille art, draw from a catalog (emojicombos.com, asciiart.eu). **Pad blank braille cells
  with `⠀` (U+2800), not an ASCII space.** Mixing braille glyphs with ASCII spaces skews alignment
  in most fonts; a uniform braille grid stays aligned. The legibility gate counts both `⠀` and a
  space as empty, so density is the inked glyphs alone.

Fit each candidate to ≤9×25. Bold line art and silhouettes survive at status-line size; photographs
turn to mush at nine rows.

**5. Run the figure-options preview.** Write the candidates to
`packages/packs/<name>/figure-candidates.json` — an array of `{ name, rows }` objects — then pass
that file path:

```
bun .claude/skills/pack-author/scripts/figure-options.ts <packDir> \
  --candidates packages/packs/<name>/figure-candidates.json
```

This writes `.author/figures.html`. Open it in a browser. The user picks a candidate or asks for a
tweak. Delete `figure-candidates.json` once a figure is chosen.

**6. Ingest the figure.** Write the chosen art into `.author/figure.txt` (the user may hand-edit
it), then run:

```
bun .claude/skills/pack-author/scripts/figure-ingest.ts <packDir>
```

This writes the `art` array into `pack.json` and runs `--schema-only` lint to confirm the figure
clears the box and legibility gate.

**7. Attribution.** Fill `attribution.artist` and `attribution.source`. Both are required; lint
fails
on either being empty.

**Gate:** `bun run lint-pack --schema-only packages/packs/<name>` exits 0.

## Stage 2: Emblem

Present four emblem candidates drawn from the character's visual vocabulary, plus a custom option.
Write the chosen glyph into `pack.json` `emblem`.

**Gate:** User confirms the emblem.

## Stage 3: Theme

Every pack ships a `theme` block in `pack.json`, registering it as a selectable palette under its
own name. Four fields:

- **`hues`**: 4 or 5 xterm-256 indices. Paints the statusline as solid bands and the figure as a
  diagonal shimmer gradient.
- **`comment`**: 2 or 3 xterm-256 indices for the character-line gradient.
- **`signals`**: `nominal` (green-family, HSV 70° to 165°), `caution` (amber-family, 20° to 55°),
  `critical` (red-family, ≤15° or ≥345°). Shade a signal color to fit the character; do not invert
  its meaning.
- **`separator`**: one index for `│` and `⋯` dividers.

All indices must be in `17..231` with chroma (max minus min of R, G, B) ≥ 40 and brightness (max of
R, G, B) ≥ 95. No system colors (0 to 16), no greyscale (232 to 255).

**1.** Seed 5–10 candidates from the character's dominant colors. Write them to
`packages/packs/<name>/theme-candidates.json` — an array of objects, each with `name`, `hues`,
`comment`, `signals`, and `separator`.

**2.** Run the preview:

```
bun .claude/skills/pack-author/scripts/theme-options.ts <packDir> \
  --candidates packages/packs/<name>/theme-candidates.json
```

This writes `.author/themes.html`. Open it. The script skips failing candidates and prints a
diagnostic for any index that violates the visibility rule.

**3.** Iterate until the user picks a candidate. Write the chosen `theme` object into `pack.json`.
Delete `theme-candidates.json`.

**Gate:** User has named the chosen theme and it is written into `pack.json`.

## Stage 4: Voice anchor

**1.** Ask the user for voice references: canonical quotes, approved samples, character-defining
moments, and tone constraints. Record everything.

**2.** Propose `tone` (`mild | edgy | offensive`). Config carries no edginess knob; the pack's tone
is the only choice a user gets. Write every line at the pack's tone: there is no separate edgy pool.
Confirm tone after the taste sample in step 4.

**3.** Build `voice-pack.md` from `voice-pack.template.md`: calibration notes (tone, phrasing,
edginess ceiling, taboo subjects) and roughly 50 canonical lines drawn from the user's references.

**4.** Draft about 50 taste-sample lines spanning all five familiarity tiers (
`stranger | acquaintance | friend | partner | legend`), one named stack key per family, and a few
spinner verbs. Keep each line ≤ 66 display columns. Keep failure and limit lines uplifting. The
character emotes; it does not scold.

**5.** Show the samples to the user and confirm `tone`.

**Gate:** User approves the samples. Approval certifies the voice axes and unblocks Stage 5.

## Stage 5: Write the 620

The voice library is exactly **620 lines**, lint-enforced:

| pool                                      | per cell | cells                 | lines |
| ----------------------------------------- | -------- | --------------------- | ----- |
| mood idle                                 | 10       | 5 tiers               | 50    |
| mood busy / happy / struggling / recovery | 5        | 4 × 5 tiers           | 100   |
| greeting                                  | 3        | 5 buckets × 5 tiers   | 75    |
| first contact                             | 3        | 5 tiers               | 15    |
| tier_up / comeback / streak / anniversary | 3        | 4 × 5 tiers           | 60    |
| positive-git                              | 3        | 4 moments × 5 tiers   | 60    |
| easter egg                                | 5        | 5 tiers               | 25    |
| pressure mood                             | 3        | 3 moods               | 9     |
| event reaction                            | 3        | 18 categories         | 54    |
| stack moment                              | 3        | 2 moments × 27 stacks | 162   |
| date/clock egg                            | 10       | flat                  | 10    |

**Rules for every line:**

- ≤ 66 display columns (ANSI-stripped). Longer lines may wrap or truncate.
- No near-duplicates: within any leaf cell, no two lines at token-set Jaccard ≥ 0.80. Two lines that
  share most of their words read as a repeat.
- Stay off the helpful catalog. The engine gives actionable instructions: billing, quota, context,
  git commands. A character line reacts to the moment; it never restates a do-this directive. Do not
  write "add it to `.gitignore`", "unset `ANTHROPIC_API_KEY`", "run `/compact`", or any other action
  command.

**Writing strategy:**

Partition leaf cells into non-overlapping batches.

On Claude: spawn one Sonnet subagent per batch (`model: sonnet`). Hand each writer `voice-pack.md`,
its assigned cells with per-cell counts, `packages/packs/batman/pack.json` as the structural
template, and `bun run lint-pack --status packages/packs/<name>` as the self-check command.

Without subagents: write batches sequentially, same inputs per batch.

After merging all batches, run one cross-cell variety pass: break any joke or phrase that reappears
across cells, which the per-cell gate cannot catch.

**Gate:** `bun run lint-pack packages/packs/<name>` passes the full content gates.

## Stage 6: Spinner verbs

The character rewrites Claude Code's spinner verbs in its own voice.

1. Draft five verbs and show them to the user.
2. After the user confirms the style, write the full set of at least **25** verbs into `pack.json`
   `spinnerVerbs`.

**Gate:** User approves the verb set. Lint enforces the 25-verb floor.

## Stage 7: Ship

**1. README + shot.** Generate the pack's `README.md` and its themed statusline shot (needs a built
render binary):

```
bun run build
bun run pack-readme packages/packs/<name>
```

This writes `README.md`: the non-affiliation disclaimer, a tagline, the statusline preview rendered
in the pack's own theme (`assets/statusline.svg`), the figure as verbatim plain glyphs (no ANSI,
braille blanks preserved), one representative line per pool, and attribution. Do not hand-edit it;
regenerate whenever the figure, theme, or voice changes — including any hand-edit to `pack.json`
`art`, which the user may make directly. `README.md` and `assets/statusline.svg` are generated,
tracked artifacts: after any such change, re-run `bun run pack-readme packages/packs/<name>` (with a
current `bun run build`) so both stay in sync with `pack.json`, then eyeball the shot.

The shot only shows the figure if the pack resolves through its workspace link. If the statusline
leads with a `[name]` chip and no figure appears, the Stage 1 `bun install` never ran (or the core
devDependency is missing); fix the link and regenerate, don't touch the art.

**2. Review.** Dispatch a reviewer subagent (never an author). It records its findings in
`REVIEW.md`: figure legibility and recognizability, lines on-voice, cross-cell variety, and
acceptable attribution.

**3. Re-author.** Address every cell the reviewer flags. Re-run `lint-pack` and regenerate the
`README.md` + shot.

**4. Final approval.** Show the user the final `pack.json` and generated `README.md`. Their sign-off
satisfies terminal-state gate 4.

**5. Add a changeset so the pack gets released.** Releases run
on [Changesets](https://github.com/changesets/changesets):
a package is published only when a changeset raises its version. The Release workflow discovers
packs through a `packages/packs/*` glob, so no workflow edit is ever needed. Just declare the bump:

```
bun run changeset
```

Select `@ccsidekick/pack-<name>`, choose `minor` (a brand-new pack's first real version), and write
a one-line summary. That writes a `.changeset/*.md` file; commit it with the pack. Nothing publishes
until a maintainer runs the Release workflow, which opens a "Version Packages" PR and, once merged,
publishes.

Note the internal-dependency behavior, in case the pack is `batman`: the engine (`ccsidekick`) has a
runtime dependency on `@ccsidekick/pack-batman`, so a batman changeset also cascades a patch bump to
the engine (it ships batman). The other packs are engine `devDependencies` and never cascade;
they version independently. Do not add `linked`/`fixed` entries for packs; independent versioning is
intentional.

**6. Delete `REVIEW.md` and commit.** `REVIEW.md` is transient reviewer scratch, removed at ship
so packs never carry it — the same treatment as the `.author/` working files. Delete it before the
commit so it never enters history, confirm the parity test, then commit by path (include the
changeset from step 5):

```
rm packages/packs/<name>/REVIEW.md
bun test packages/core/src/packs/registry.test.ts
git add packages/packs/<name> .changeset
git commit -m "feat(packs): add <name> pack"
```

Do not `git commit --amend` across a multi-commit local series (amend hits `HEAD`, not the commit
you intend). A secret-scanning hook runs on every push.

## Quick reference

| Command                                                                                    | Purpose                                                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `bun .claude/skills/pack-author/scripts/scaffold.ts <name> --display "<N>" --emblem "<g>"` | Create skeleton pack, register in `PACKS`, link as core runtime dependency (then `bun install`) |
| `bun .claude/skills/pack-author/scripts/figure-options.ts <packDir> --candidates <json>`   | Render figure candidates → `.author/figures.html`                                               |
| `bun .claude/skills/pack-author/scripts/figure-ingest.ts <packDir>`                        | Write `.author/figure.txt` into `pack.json` art; runs `--schema-only` lint                      |
| `bun .claude/skills/pack-author/scripts/theme-options.ts <packDir> --candidates <json>`    | Render theme candidates → `.author/themes.html`                                                 |
| `bun run lint-pack --schema-only packages/packs/<name>`                                    | Schema guard + legibility gate (skips content counts)                                           |
| `bun run lint-pack --status packages/packs/<name>`                                         | Per-cell fill status: current count vs. target per leaf                                         |
| `bun run lint-pack packages/packs/<name>`                                                  | Full lint: all schema, content, and quality gates                                               |
| `bun run pack-readme packages/packs/<name>`                                                | Write `README.md` + themed `assets/statusline.svg` (needs `bun run build`)                      |
| `bun test packages/core/src/packs/registry.test.ts`                                        | Registry parity test                                                                            |
