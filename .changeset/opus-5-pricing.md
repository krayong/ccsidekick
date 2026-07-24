---
"ccsidekick": patch
---

Price Claude Opus 5. The published pricing page listed the model under a display name the pricing generator had no key mapping for, so it never reached `pricing.json` and every Opus 5 message priced to $0 in Chat, Project, and Total. The bundled table now carries the full Opus 5 rate card: $5/$25 per MTok base, $6.25 and $10 cache writes, $0.50 cache reads, and a fast-mode multiplier of 2.
