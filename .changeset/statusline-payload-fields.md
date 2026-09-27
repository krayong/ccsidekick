---
"ccsidekick": minor
---

Read three newer statusline payload fields. The `cache_hit` widget now shows Claude Code's session-wide `prompt_cache.hit_ratio`, and `fast_mode` reads the payload's `fast_mode` flag. Both fall back to the transcript on older Claude Code versions. The `pr` widget shows a GitLab merge request as `MR: !n`.
