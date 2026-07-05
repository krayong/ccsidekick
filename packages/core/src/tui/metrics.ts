// TTL-gated access to the full analytics catalog for the Stats view. The aggregate is recomputed at most once
// per `ANALYTICS_TTL_MS`; in between the last value is served, the same shape the cost path uses. TUI-only.

import { type AllMetrics, deriveAllMetrics } from "../derived";
import { ANALYTICS_TTL_MS } from "../domain";
import { type Clock, readAttribution, readCostCache, repoRootForCwd } from "../sources";

let cache: { root: string; ts: number; value: AllMetrics } | null = null;

/** Derive the catalog for the ccsidekick root (`<configDir>/ccsidekick`), gated behind `ANALYTICS_TTL_MS`. */
export function loadMetrics(root: string, clock: Clock): AllMetrics {
	const now = clock.now();
	if (cache !== null && cache.root === root && now - cache.ts < ANALYTICS_TTL_MS) {
		return cache.value;
	}
	// Group a repo's subdirectories and in-repo worktrees under one project (by git repo root) instead of one
	// entry per working directory. Filesystem-based and memoized; fine off the hot path, behind the TTL gate.
	const value = deriveAllMetrics(
		readAttribution(root),
		readCostCache(root),
		clock,
		repoRootForCwd,
	);
	cache = { root, ts: now, value };
	return value;
}
