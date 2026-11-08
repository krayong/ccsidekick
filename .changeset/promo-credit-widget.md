---
"ccsidekick": minor
---

Add a `promo_credit` widget for promotional model credits such as the Frontier model credit. It reads `promo_credits` from the account-usage lookup and renders one field per promo, in server order, right after pay-as-you-go: `🎁 Frontier Model Credit: $11.08/$20000 (26d 9h left)`. The label comes from the server, title-cased. The field colours like pay-as-you-go (caution past 60%, critical past 80% or when the credit is used up or locked) and hides when the account has no promo. It needs `[network].usage_fetch` on.
