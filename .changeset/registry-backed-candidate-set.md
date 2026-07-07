---
"ccsidekick": minor
---

Resolve the random-pick candidate set from the bundled pack registry instead of scanning the filesystem for installed packs. Every pack ships with the engine, so the on-disk `installed`/`engineRoot` scan is gone from the render and save paths.

A persisted character pick is now revalidated against the current config before it sticks: in `fixed` mode it must equal the configured name, in `random` mode it must still be a candidate. Narrowing the roster now evicts a dropped character instead of letting the stale pick persist.

Fix a narrow-terminal overflow: when the dropped-figure `[name]` chip is wide (a long character name), the statusline no longer runs one column past its budget. Truncation now cascades from the tail across cells, so a protected field shrinks rather than pushing the row past the edge.
