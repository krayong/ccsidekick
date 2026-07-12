---
"ccsidekick": minor
---

Add a `--usage-fetch <on|off>` flag to `ccsidekick setup`, so the account-usage lookup can be enabled non-interactively (it writes `[network].usage_fetch`). This is the one data source the pay-as-you-go widget needs, since its numbers come only from the account and cannot be derived from local transcripts. Everything else stays off by default.
