import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EVENT_LOG_MAX, MOOD_WINDOW_MS, isEventCategory, isStack, type Event } from "../domain";

import type { Clock } from "./clock";
import { appendBounded } from "./storage";

const EVENTS_FILE = "events.jsonl";

/** Coerce one parsed JSONL value into an Event, dropping anything off-shape. */
function coerceEvent(raw: unknown): Event | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const o = raw as Record<string, unknown>;
	const ts = o["ts"];
	const category = o["category"];
	if (typeof ts !== "number" || !Number.isFinite(ts)) return undefined;
	if (typeof category !== "string" || !isEventCategory(category)) return undefined;
	const stack = o["stack"];
	return typeof stack === "string" && isStack(stack) ? { ts, category, stack } : { ts, category };
}

/**
 * Read the classified-event log, dropping malformed lines and entries older than `MOOD_WINDOW_MS`
 * (the widest window any consumer reads). Never throws: a missing or unreadable log reads as empty.
 */
export function readEvents(sessionDir: string, clock: Clock): Event[] {
	let text: string;
	try {
		text = readFileSync(join(sessionDir, EVENTS_FILE), "utf8");
	} catch {
		return [];
	}
	const cutoff = clock.now() - MOOD_WINDOW_MS;
	const out: Event[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		const event = coerceEvent(parsed);
		if (event !== undefined && event.ts >= cutoff) out.push(event);
	}
	return out;
}

/** Append one classified event, trimming the log back to `EVENT_LOG_MAX` when it overflows. */
export function appendEvent(sessionDir: string, e: Event): void {
	appendBounded(join(sessionDir, EVENTS_FILE), JSON.stringify(e), EVENT_LOG_MAX);
}
