import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { SESSION_TTL_DAYS } from "../domain";
import { type Clock, type CostFileEntry, readCostCache, writeCostCache } from "../sources";

const DAY_MS = 86_400_000;

/** The newest mtime across a session dir and its immediate files — the dir's last-activity marker. */
function newestMtime(dir: string): number {
	let newest = 0;
	try {
		newest = statSync(dir).mtimeMs;
		for (const name of readdirSync(dir)) {
			try {
				const m = statSync(join(dir, name)).mtimeMs;
				if (m > newest) newest = m;
			} catch {
				/* skip an unstatable entry */
			}
		}
	} catch {
		/* dir vanished mid-scan */
	}
	return newest;
}

/** Remove `sessions/<id>/` dirs whose newest mtime is older than `SESSION_TTL_DAYS`. */
function pruneSessions(root: string, now: number): void {
	const sessions = join(root, "sessions");
	let names: string[];
	try {
		names = readdirSync(sessions);
	} catch {
		return; // no sessions dir yet
	}
	const cutoff = now - SESSION_TTL_DAYS * DAY_MS;
	for (const name of names) {
		const dir = join(sessions, name);
		try {
			if (!statSync(dir).isDirectory()) continue;
		} catch {
			continue;
		}
		if (newestMtime(dir) < cutoff) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

/** Drop `cache/cost.json` `files` entries whose source transcript path no longer exists. */
function pruneCostCache(root: string): void {
	const cache = readCostCache(root);
	const kept: Record<string, CostFileEntry> = {};
	let dropped = false;
	for (const [path, entry] of Object.entries(cache.files)) {
		if (existsSync(path)) kept[path] = entry;
		else dropped = true;
	}
	if (dropped) writeCostCache(root, { ...cache, files: kept });
}

/**
 * Best-effort GC on the render persist tail: prune stale session dirs and dangling cost-cache entries.
 * Never touches `analytics/store.json`; every failure is swallowed so a failed GC never blocks a render.
 */
export function runGc(root: string, clock: Clock): void {
	try {
		pruneSessions(root, clock.now());
	} catch {
		/* best effort */
	}
	try {
		pruneCostCache(root);
	} catch {
		/* best effort */
	}
}
