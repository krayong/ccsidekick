---
"ccsidekick": minor
---

Spread `random` character assignment by least-recently-used. A new session now picks the character
whose most recent use across sessions is oldest (a never-used one wins outright), and only breaks
ties within that group by the existing session-id hash. History is tracked with a per-session
`updatedMs` stamp on the attribution store; legacy rows without it read as long-ago and re-stamp on
next use, so no migration is needed. A fresh install has no history and every candidate ties, so the
first sessions still fall through to the hash pick — the spreading builds up as history accumulates.

Refresh the theme catalog. Drop the 13 light-background themes, which read muddy on a dark terminal,
leaving 57 dark and high-contrast entries; a config that names a removed theme falls back to the
default. Recolor a dozen dark themes whose palettes had collided so each reads distinctly (material
and palenight were identical, as were VS Code Dark+ and its high-contrast twin, alongside near-dupes
across the Material, Tokyo, Nord, and GitHub families). Brighten the last few dim accent and signal
stops in Solarized Dark, Darcula, Rosé Pine, and Kanagawa so nothing looks washed out.
