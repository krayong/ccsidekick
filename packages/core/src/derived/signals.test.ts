import { expect, test } from "bun:test";

import { QUOTA_HIGH_PCT, QUOTA_PACE_MIN_PCT } from "../domain";

import { band, contextBand, quotaBand } from "./signals";

const W5H = 5 * 60 * 60 * 1000;
/** resets_at (at now=0) that puts the window `frac` of the way through its span. */
const atElapsed = (frac: number): number => W5H * (1 - frac);

test("contextBand fixed cutoffs at 33/34 and 66/67", () => {
	expect(contextBand(0)).toBe("nominal");
	expect(contextBand(33)).toBe("nominal");
	expect(contextBand(34)).toBe("caution");
	expect(contextBand(66)).toBe("caution");
	expect(contextBand(67)).toBe("critical");
	expect(contextBand(100)).toBe("critical");
});

test("quotaBand: ≥80% used is always critical, on pace or with no reset", () => {
	expect(quotaBand(80, atElapsed(0.5), W5H, 0)).toBe("critical");
	expect(quotaBand(85, undefined, W5H, 0)).toBe("critical");
	expect(QUOTA_HIGH_PCT).toBe(80);
});

test("quotaBand: pace-vs-runway bands below 80% — r≤1 nominal, ≤1.5 caution, >1.5 critical", () => {
	expect(quotaBand(50, atElapsed(0.5), W5H, 0)).toBe("nominal"); // r=1.0
	expect(quotaBand(50, atElapsed(0.4), W5H, 0)).toBe("caution"); // r=1.25
	expect(quotaBand(60, atElapsed(0.3), W5H, 0)).toBe("critical"); // r=2.0
});

test("quotaBand: usage below the pace-min floor ignores pace (a fresh window at 2% is nominal)", () => {
	// 2% used but only ~1% into the window: pace ratio r≈2 would read critical without a floor. Below the floor
	// the band falls back to the raw-percentage context band, so trivial usage early in a window stays calm.
	expect(QUOTA_PACE_MIN_PCT).toBe(20);
	expect(quotaBand(2, atElapsed(0.01), W5H, 0)).toBe("nominal"); // r=2.0 but 2% < 20% floor
	expect(quotaBand(19, atElapsed(0.02), W5H, 0)).toBe("nominal"); // just below the floor
});

test("quotaBand: at or above the floor, over-pace still escalates", () => {
	expect(quotaBand(20, atElapsed(0.05), W5H, 0)).toBe("critical"); // floor inclusive: r=4.0
	expect(quotaBand(25, atElapsed(0.1), W5H, 0)).toBe("critical"); // r=2.5
});

test("quotaBand: without resets_at falls back to the context bands", () => {
	expect(quotaBand(10, undefined, W5H, 0)).toBe("nominal");
	expect(quotaBand(50, undefined, W5H, 0)).toBe("caution");
	expect(quotaBand(70, undefined, W5H, 0)).toBe("critical");
});

test("generic band is ascending-threshold", () => {
	const t = { caution: 10, critical: 20 };
	expect(band(9, t)).toBe("nominal");
	expect(band(10, t)).toBe("caution");
	expect(band(19, t)).toBe("caution");
	expect(band(20, t)).toBe("critical");
});
