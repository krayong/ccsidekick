---
"ccsidekick": patch
---

Let the render clock be pinned for reproducible snapshots. `ccsidekick-render render` now honors `CCSIDEKICK_NOW` (epoch milliseconds, with an optional `CCSIDEKICK_TZ`): when it holds a finite number, the figure shimmer phase and every countdown derive from that fixed instant, so a generated status-line shot is byte-identical from one run to the next. Left unset, the binary reads the system clock exactly as before.
