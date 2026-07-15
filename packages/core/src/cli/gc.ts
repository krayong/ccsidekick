import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { SESSION_TTL_DAYS } from "../domain";
import { type Clock, type CostFileEntry, readCostCache, writeCostCache } from "../sources";

const DAY_MS = 86_400_000;

// GC is best-effort housekeeping that only reacts to a day-scale TTL, so it need not run every 1 s tick.
// Gate it behind a stamp file: skip unless this long since the last run. The stamp stores the injected
// clock's value (not the file mtime) so the throttle is deterministic under a fixed clock.
const GC_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The `clock.now()` value recorded at the last GC run, or `undefined` when never run / unreadable. */
function readGcStamp(path: string): number | undefined {
	try {
		const n = Number(readFileSync(path, "utf8"));
		return Number.isFinite(n) ? n : undefined;
	} catch {
		return undefined;
	}
}

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

/**
 * Drop `cache/cost.json` `files` entries whose source transcript path no longer exists, and prune the
 * `aggregate.chat` map (payload-cost fallbacks) to sessions that still have a live transcript — otherwise it
 * grows one entry per session ever seen. Safe: `deriveCost` reads `chat` only for the current session, whose
 * transcript is always live.
 */
function pruneCostCache(root: string): void {
	const cache = readCostCache(root);
	const kept: Record<string, CostFileEntry> = {};
	const liveSessions = new Set<string>();
	let dropped = false;
	for (const [path, entry] of Object.entries(cache.files)) {
		if (existsSync(path)) {
			kept[path] = entry;
			liveSessions.add(String(entry.record.session));
		} else {
			dropped = true;
		}
	}
	const chatKept: Record<string, number> = {};
	let chatDropped = false;
	for (const [session, cost] of Object.entries(cache.aggregate.chat)) {
		if (liveSessions.has(session)) chatKept[session] = cost;
		else chatDropped = true;
	}
	if (dropped || chatDropped) {
		writeCostCache(root, {
			...cache,
			files: kept,
			aggregate: { ...cache.aggregate, chat: chatKept },
		});
	}
}

/**
 * Best-effort GC on the render persist tail: prune stale session dirs and dangling cost-cache entries.
 * Never touches `analytics/store.json`; every failure is swallowed so a failed GC never blocks a render.
 */
export function runGc(root: string, clock: Clock): void {
	const now = clock.now();
	const stampPath = join(root, "cache", ".gc-stamp");
	const last = readGcStamp(stampPath);
	if (last !== undefined && now - last < GC_MIN_INTERVAL_MS) return;

	try {
		pruneSessions(root, now);
	} catch {
		/* best effort */
	}
	try {
		pruneCostCache(root);
	} catch {
		/* best effort */
	}
	try {
		mkdirSync(join(root, "cache"), { recursive: true });
		writeFileSync(stampPath, String(now));
	} catch {
		/* best effort: a missing stamp just means GC runs again next tick */
	}
}
