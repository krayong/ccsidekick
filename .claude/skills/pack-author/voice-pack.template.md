# Voice pack: <Character>

Copy this file into the working tree as `voice-pack` and fill it in. It is the planning anchor for the 620-line
library: the voice reference up top, then a per-pool worksheet with exact counts. Write the lines themselves into
`pack.json` under `lines`; use this file to derive the voice and to track coverage.

## Character anchor

**Canonical quotes.** Paste 30 to 50 real lines for the character (dialogue, narration, catchphrases). These set
the diction every authored line answers to.

- …

**Approved samples.** The Stage II sample lines the user signed off on. Keep them here as the calibration set.

- …

**Derived voice.** Write the rules you pulled from the quotes:

- Diction and rhythm: …
- Recurring imagery or motifs: …
- What the character would never say: …

**DO / DON'T.** 6–10 on-voice vs off-voice pairs. Each pair shows the same moment in two registers: right tone
vs wrong tone. Fill in 6 minimum; add up to 10 where the character's voice is easy to miss.

| DO (on voice) | DON'T (off voice) |
| ------------- | ----------------- |
| …             | …                 |
| …             | …                 |
| …             | …                 |
| …             | …                 |
| …             | …                 |
| …             | …                 |

## Tone

- **Tone** (`mild | edgy | offensive`): __ . Config carries no edginess knob, so this is the only tone a user
  gets. Write every pool at it; there is no separate edgy pool.

Two rules hold across every line:

- The character emotes; it never scolds the user. Keep failure, pressure, and limit lines uplifting.
- Width cap: each line is at most **66 display columns** (ANSI-stripped). Near-duplicates within one cell fail
  the lint at token-set Jaccard **0.80**, so reword rather than repeat.

## Helpful-catalog boundary

The engine owns a separate catalog of actionable nudges. Packs cannot author those.
A character line is flavor; it must **not** restate an instruction the engine already gives. React to the moment,
leave the fix to the engine.

| engine category | the engine already says (do not restate)                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| safety          | ignore a secret file, branch off a detached HEAD, warn after a force-push, check a prod cluster           |
| billing         | unset `ANTHROPIC_API_KEY`, raise the pay-as-you-go cap, top up the prepaid balance                        |
| quota           | ration heavy requests against the 5h block and the weekly limit                                           |
| context         | run `/compact` or `/clear`, commit before a compact, take a break                                         |
| git             | list conflicts, `git push -u`, pull or rebase when behind, drop stale stashes, continue an interrupted op |
| workflow        | check off a stalled todo, raise the effort level                                                          |

A useful test: if a line tells the user a command to run or a setting to change, it belongs to the engine. Cut it.

## The 620-line worksheet

Familiarity **tiers** (all five authored in full, no fallback): `stranger`, `acquaintance`, `friend`, `partner`,
`legend`. Write the count shown for every cell. Replicate the blank block per cell.

### mood (150 lines)

_Ambient presence. Each sub-mood colors the character's baseline state. Idle is the character at rest, breathing
in their natural voice with no task pressure. Busy, happy, struggling, and recovery each respond to what Claude
Code is actively doing; the character shifts register, not subject matter._

`idle` carries 10 lines per tier; `busy`, `happy`, `struggling`, `recovery` carry 5 per tier.

- `mood.idle.<tier>`: 10 each × 5 tiers = **50**
- `mood.busy.<tier>`: 5 each × 5 tiers = **25**
- `mood.happy.<tier>`: 5 each × 5 tiers = **25**
- `mood.struggling.<tier>`: 5 each × 5 tiers = **25**
- `mood.recovery.<tier>`: 5 each × 5 tiers = **25**

```
mood.idle.stranger (10):
1. …
2. …
( … through 10 )
```

### greeting (75 lines)

_Time-of-day acknowledgment. The character meets the user where they are: morning alertness, midday focus,
evening wind-down, late-night solidarity, weekend ease. Keep it personal, not performative; the time slot is
context, not content._

Time buckets: `morning`, `day`, `evening`, `night`, `weekend`. 3 lines per (bucket, tier).

- `greeting.<bucket>.<tier>`: 3 each × 5 buckets × 5 tiers = **75**

```
greeting.morning.stranger (3):
1. …
2. …
3. …
```

### firstContact (15 lines)

_Debut impression. The character introduces themselves to a brand-new user, setting the relationship register that
will deepen across tiers. Write as if the character has just walked in: present tense, forward-facing, no
history yet to draw on._

The first thing the character says to a brand-new user, 3 per tier.

- `firstContact.stranger`: 3
- `firstContact.acquaintance`: 3
- `firstContact.friend`: 3
- `firstContact.partner`: 3
- `firstContact.legend`: 3

### milestone (60 lines)

_Earned recognition. Marks real progress: tier advancement, a comeback after a rough patch, a streak, a session
anniversary. Give the moment genuine weight without overselling it; the win belongs to the user._

Types: `tier_up`, `comeback`, `streak`, `anniversary`. 3 per (type, tier).

- `milestone.<type>.<tier>`: 3 each × 4 types × 5 tiers = **60**

### positiveGit (60 lines)

_Good version-control moments. The character notices craft and discipline in the user's work. Stay observational;
a clean tree or a pushed tag is the user's achievement, not the character's._

Moments: `clean_tree`, `op_cleared`, `branch_created`, `tag_pushed`. 3 per (moment, tier).

- `positiveGit.<moment>.<tier>`: 3 each × 4 moments × 5 tiers = **60**

### egg (25 lines)

_Rare easter eggs. The character surfaces an unexpected angle, something that only emerges after real time
together. Keep each line singular; it should feel like a discovery, not a callback to something obvious._

Rare easter-egg lines, 5 per tier.

- `egg.<tier>`: 5 each × 5 tiers = **25**

### event (54 lines)

_Tool reactions. The character comments on what just happened: wry, never scolding; the character shoulders the
moment rather than pointing at the user. Failure lines (`test_fail`, `build_fail`, `typecheck_fail`, etc.) stay
uplifting: the character feels it too and keeps moving._

The 18 reaction categories, 3 lines each. Keep the failure ones uplifting.

`test_fail`, `build_fail`, `typecheck_fail`, `lint`, `format`, `install`, `git`, `file_edit`, `search`,
`web_fetch`, `todo_update`, `agent_spawn`, `skill_run`, `docker`, `k8s`, `deploy`, `db_migrate`, `dangerous`.

- `event.<category>`: 3 each × 18 = **54**

### stack (162 lines)

_Ecosystem color. The character speaks each technology's language without sycophancy or imposter syndrome.
`slow` is patience: the character waits alongside the user. `fail` is solidarity: the character acknowledges
the breakage without making it bigger than it is._

The 27 stacks, two moments each (`slow`, `fail`), 3 lines per (stack, moment).

`web`, `python`, `sql`, `web-framework`, `docker`, `java`, `go`, `node`, `dotnet`, `cpp`, `php`, `rust`,
`kubernetes`, `ml`, `android`, `ruby`, `ios`, `terraform`, `graphql`, `flutter`, `react-native`, `scala`,
`protobuf`, `game`, `docs`, `r`, `cuda`.

- `stack.<stack>.slow`: 3 each × 27 = 81
- `stack.<stack>.fail`: 3 each × 27 = 81
- subtotal = **162**

### pressure (9 lines)

_Near-limit tension. The character stays composed: acknowledgment without alarm, forward motion without false
cheer. These lines reuse the `struggling` figure, so the visual and verbal register should match: tense but
steady, never panicked._

Synthetic pressure moods (reuse the `struggling` figure), 3 each.

- `pressure.compact_hint`: 3
- `pressure.block_limit`: 3
- `pressure.weekly_limit`: 3

### dateEgg (10 lines)

_Calendar and clock easter eggs. The character notices something the user is probably not thinking about: a
date, a time, a coincidence. Flat pool (no tier), so every line must stand on its own._

Flat date/clock easter eggs, **10** total.

```
dateEgg (10):
1. …
( … through 10 )
```

### spinnerVerbs

_Not part of the 620, but lint-floored at **25**. Rewrite Claude Code's spinner verbs in the character's voice.
Write short present-progressive phrases that feel native to the character, not pulled from a synonym list._

- …

## Coverage

Run `lint-pack --status <pack>` for live per-cell coverage. The canonical counts live in `poolShape.ts`; they are
not duplicated here.
