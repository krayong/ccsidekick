---
"ccsidekick": patch
---

Fix the incremental cost-scan resume to carry a session's time bounds exactly as a full parse does.

- `record.end` now advances from every appended line, not just usage-bearing ones. A tick landing on the common mid-turn state (a trailing user or tool line logged after the last assistant message) no longer leaves the session end frozen at the last assistant timestamp, so session duration and recency read correctly instead of lagging by up to a turn.
- `record.start` is now widened symmetrically. A resumed session opening with an undated `summary` line (start clamped to 0) no longer keeps that clamp after dated lines are appended, fixing a "working since 1970" collapse in the tenure and streak display.
