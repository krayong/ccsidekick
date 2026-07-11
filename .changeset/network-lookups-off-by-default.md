---
"ccsidekick": minor
---

Network lookups are now off by default. `usage_fetch` (the OAuth account-usage widget, which sends your Anthropic token to Anthropic's account-usage endpoint) and `fx_refresh` (the weekly currency-rate refresh) both default to `false`. Enable either under `[network]` if you want it. Out of the box ccsidekick now makes no network calls at all, so it is local-first by default and both lookups are opt-in.
