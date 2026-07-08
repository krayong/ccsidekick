import { join } from "node:path";

import { analyticsDir, atomicWrite, readJson, withLock } from "./storage";

/** One cross-Session attribution row: the only fact analytics records that transcripts cannot carry. */
export interface AttributionEntry {
	readonly project: string;
	readonly character: string;
	/** Last tick (ms) this row was written; the recency signal for LRU character assignment. Absent on legacy rows. */
	readonly updatedMs?: number;
}

/** `sessionId → { project, character }`. Never GC'd; powers per-Character familiarity tiers. */
export interface AttributionStore {
	readonly [sessionId: string]: AttributionEntry;
}

const STORE_FILE = "store.json";

function coerceStore(raw: unknown): Record<string, AttributionEntry> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const out: Record<string, AttributionEntry> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== "object" || value === null) continue;
		const entry = value as Record<string, unknown>;
		const project = entry["project"];
		const character = entry["character"];
		if (typeof project === "string" && typeof character === "string") {
			const updatedMs = entry["updatedMs"];
			out[key] =
				typeof updatedMs === "number" ?
					{ project, character, updatedMs }
				:	{ project, character };
		}
	}
	return out;
}

function storePath(root: string): string {
	return join(analyticsDir(root), STORE_FILE);
}

/** Lock-guarded read; a held lock falls back to the read-only path. Corrupt/missing reads as empty. */
export function readAttribution(root: string): AttributionStore {
	const path = storePath(root);
	const read = (): AttributionStore => coerceStore(readJson<unknown>(path, undefined));
	return withLock(`${path}.lock`, read, read);
}

/**
 * Record (or overwrite) one Session's Character attribution. Lock-guarded read-modify-write; under a held
 * lock the write is skipped. The `"default"` Session is never recorded.
 */
export function upsertAttribution(root: string, sessionId: string, rec: AttributionEntry): void {
	if (sessionId === "default") return;
	const path = storePath(root);
	withLock(
		`${path}.lock`,
		() => {
			const store = coerceStore(readJson<unknown>(path, undefined));
			store[sessionId] =
				rec.updatedMs !== undefined ?
					{ project: rec.project, character: rec.character, updatedMs: rec.updatedMs }
				:	{ project: rec.project, character: rec.character };
			atomicWrite(path, JSON.stringify(store));
		},
		() => {
			/* lock held: skip the write */
		},
	);
}
