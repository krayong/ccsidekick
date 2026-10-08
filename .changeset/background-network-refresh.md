---
"ccsidekick": patch
---

Fix account usage and exchange rates never refreshing from the status line. Claude Code kills the statusline process before a network fetch can finish, so the usage cache kept serving its first snapshot and Enterprise and Team plans showed no current spend. The render now hands each due refresh to a detached `ccsidekick-render refresh` child, and the fetch completes even when the statusline process is killed straight away.
