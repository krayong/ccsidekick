import { join } from "node:path";

import { atomicWrite, readJson, withLock } from "./storage";

export interface SessionState {
	readonly character?: string;
	readonly pressureFired: readonly string[];
	readonly milestones: readonly string[];
	readonly helpful: Readonly<Record<string, { shownSinceTs: number; dismissedUntilTs: number }>>;
}

const STATE_FILE = "state.json";

const EMPTY: SessionState = { pressureFired: [], milestones: [], helpful: {} };

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asHelpful(v: unknown): Record<string, { shownSinceTs: number; dismissedUntilTs: number }> {
	if (!isObject(v)) return {};
	const out: Record<string, { shownSinceTs: number; dismissedUntilTs: number }> = {};
	for (const [key, raw] of Object.entries(v)) {
		if (!isObject(raw)) continue;
		const shownSinceTs = raw["shownSinceTs"];
		const dismissedUntilTs = raw["dismissedUntilTs"];
		if (typeof shownSinceTs !== "number" || typeof dismissedUntilTs !== "number") continue;
		out[key] = { shownSinceTs, dismissedUntilTs };
	}
	return out;
}

/**
 * Read per-Session render state, field-coercing every key so a valid-JSON wrong shape (e.g. an array,
 * which `readJson` passes through unchanged) cannot reach the render path. Defaults to empty on miss/corrupt.
 */
export function readState(sessionDir: string): SessionState {
	const raw = readJson<unknown>(join(sessionDir, STATE_FILE), undefined);
	if (!isObject(raw)) return EMPTY;
	const character = raw["character"];
	return {
		...(typeof character === "string" ? { character } : {}),
		pressureFired: asStringArray(raw["pressureFired"]),
		milestones: asStringArray(raw["milestones"]),
		helpful: asHelpful(raw["helpful"]),
	};
}

function union(a: readonly string[], b: readonly string[]): string[] {
	return [...new Set([...a, ...b])];
}

type HelpfulEntry = SessionState["helpful"][string];

/**
 * Reconcile a just-computed state against the current on-disk state so overlapping same-Session ticks never
 * drop a latch. Set-like latches (`pressureFired`, `milestones`) are unioned. `helpful` unions keys and, on a
 * collision, keeps the entry carrying the newer dismissal cooldown, then the later first-shown latch — a
 * concurrent dismiss or first-show is never rolled back. `character` reflects the current selection, so the
 * just-computed value wins.
 */
function mergeState(disk: SessionState, next: SessionState): SessionState {
	const character = next.character ?? disk.character;
	const helpful: Record<string, HelpfulEntry> = { ...disk.helpful };
	for (const [id, entry] of Object.entries(next.helpful)) {
		const prev = helpful[id];
		const keep =
			prev === undefined ||
			entry.dismissedUntilTs > prev.dismissedUntilTs ||
			(entry.dismissedUntilTs === prev.dismissedUntilTs &&
				entry.shownSinceTs >= prev.shownSinceTs);
		helpful[id] = keep ? entry : prev;
	}
	return {
		...(character !== undefined ? { character } : {}),
		pressureFired: union(disk.pressureFired, next.pressureFired),
		milestones: union(disk.milestones, next.milestones),
		helpful,
	};
}

/**
 * Persist per-Session render state under an `O_EXCL` lock: re-read the current on-disk state, merge the
 * just-computed latches into it, then atomically write (write-tmp-rename). The lock is held only for the
 * read-merge-write, never across the compose. Under a held lock the write is skipped rather than blocking the
 * render — the same best-effort tradeoff the cost cache makes.
 */
export function writeState(sessionDir: string, s: SessionState): void {
	const path = join(sessionDir, STATE_FILE);
	withLock(
		`${path}.lock`,
		() => {
			atomicWrite(path, JSON.stringify(mergeState(readState(sessionDir), s)));
		},
		() => {
			/* lock held: skip the write */
		},
	);
}
