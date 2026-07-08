---
"ccsidekick": minor
---

Spread `random` character assignment by least-recently-used. A new session now picks the character
whose most recent use across sessions is oldest (a never-used one wins outright), and only breaks
ties within that group by the existing session-id hash. History is tracked with a per-session
`updatedMs` stamp on the attribution store; legacy rows without it read as long-ago and re-stamp on
next use, so no migration is needed. A fresh install has no history and every candidate ties, so the
first sessions still fall through to the hash pick — the spreading builds up as history accumulates.
