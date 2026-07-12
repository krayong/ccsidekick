---
"ccsidekick": patch
---

Helpful-comment tuning and a git fix.

- The `no_upstream` tip no longer fires once a branch is already on the remote. A branch pushed without `-u` has no configured upstream but does have a local `origin/<branch>` ref, and the tip now checks that ref (a local lookup, never a network call) before nagging.
- The default comment floor `[comments].min_severity` is now `medium`. `detached_head` and `effort_low` move up to medium so they still show at that floor; `pay_as_you_go_active` moves down to low.
- Reworded the compaction tip. A compact summarizes the conversation, not the working tree, so uncommitted files survive it. It now reads "Commit now while the context is fresh."
