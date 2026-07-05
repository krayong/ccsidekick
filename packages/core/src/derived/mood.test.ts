import { expect, test } from "bun:test";

import type { Event, EventCategory } from "../domain";
import { type Payload, fixedClock } from "../sources";

import type { ContextInfo } from "./context";
import { deriveMood } from "./mood";
import type { QuotaInfo } from "./quota";

const NOW = 1_000_000_000_000;
const clock = fixedClock(NOW);
const payload: Payload = { workspace: {}, model: {} };

const ctx = (over: Partial<ContextInfo> = {}): ContextInfo => ({
	usedPct: 0,
	usedTokens: 0,
	windowSize: 0,
	band: "nominal",
	compactions: 0,
	cacheHitPct: 0,
	compactPressure: false,
	...over,
});

const NO_QUOTA: QuotaInfo = {};
const ev = (category: EventCategory, msAgo: number): Event => ({ ts: NOW - msAgo, category });

const mood = (events: Event[], quota: QuotaInfo = NO_QUOTA, context: ContextInfo = ctx()): string =>
	deriveMood(events, payload, quota, context, clock);

test("no live events ⇒ idle", () => {
	expect(mood([])).toBe("idle");
	// an event older than the window is not live
	expect(mood([ev("test_fail", 600_000)])).toBe("idle");
});

test("a pass following an earlier fail ⇒ recovery (checked before struggling)", () => {
	const events = [
		ev("test_fail", 5000),
		ev("test_fail", 4000),
		ev("test_fail", 3000),
		ev("test_pass", 1000),
	];
	expect(mood(events)).toBe("recovery");
});

test("≥ MOOD_FAIL_N fails and the latest signal is not a pass ⇒ struggling", () => {
	const events = [ev("test_fail", 5000), ev("build_fail", 4000), ev("typecheck_fail", 1000)];
	expect(mood(events)).toBe("struggling");
});

test("the latest pass with no prior fail ⇒ happy", () => {
	expect(mood([ev("test_pass", 1000)])).toBe("happy");
});

test("activity with no pass/fail signal ⇒ busy", () => {
	expect(mood([ev("file_edit", 1000), ev("search", 500)])).toBe("busy");
});

test("a lone fail below the threshold ⇒ busy", () => {
	expect(mood([ev("test_fail", 1000)])).toBe("busy");
});

test("a tripped pressure threshold overrides the base for the figure", () => {
	const busy = [ev("file_edit", 1000)];
	expect(mood(busy, NO_QUOTA, ctx({ compactPressure: true }))).toBe("compact_hint");
	expect(mood(busy, { block: { usedPct: 81, band: "critical" } })).toBe("block_limit");
	expect(mood(busy, { weekly: { usedPct: 90, band: "critical" } })).toBe("weekly_limit");
	// compaction takes precedence over a quota trip
	expect(
		mood(busy, { block: { usedPct: 99, band: "critical" } }, ctx({ compactPressure: true })),
	).toBe("compact_hint");
	// just under the quota threshold ⇒ no pressure, base mood stands
	expect(mood(busy, { block: { usedPct: 80, band: "critical" } })).toBe("busy");
});
