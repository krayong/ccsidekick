import { expect, test } from "bun:test";

import { SHIMMER_PERIOD_MS } from "../domain";

import { xtermToRgb, rgbToXterm } from "./color";
import { figureColor, figureFits } from "./figure";

test("figureFits at the 80 boundary", () => {
	expect(figureFits(80)).toBe(true);
	expect(figureFits(79)).toBe(false);
	expect(figureFits(200)).toBe(true);
});

const HUES = [75, 147, 77, 222, 210];

// Re-derive the gradient formula independently to pin figureColor at a fixed cell.
const frac = (x: number): number => x - Math.floor(x);
const smoothstep = (x: number): number => x * x * (3 - 2 * x);
const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
	a[0]! + (b[0]! - a[0]!) * t,
	a[1]! + (b[1]! - a[1]!) * t,
	a[2]! + (b[2]! - a[2]!) * t,
];
const expected = (x: number, y: number, w: number, h: number, phase: number): number => {
	const t = (x / Math.max(1, w - 1) + y / Math.max(1, h - 1)) / 2 + phase;
	const n = HUES.length;
	const p = frac(t) * n;
	const i = Math.floor(p);
	const c = mix(xtermToRgb(HUES[i % n]!), xtermToRgb(HUES[(i + 1) % n]!), smoothstep(p - i));
	return rgbToXterm(c);
};

test("figureColor matches the gradient formula; drifts on wall-clock with no tint when mood_shift is off", () => {
	expect(figureColor(HUES, 3, 2, 25, 9, "idle", 0, false)).toBe(expected(3, 2, 25, 9, 0));
	// mood_shift off still drifts: the phase tracks wall-clock; only the mood tint is suppressed.
	const phase = frac(12345 / SHIMMER_PERIOD_MS);
	expect(figureColor(HUES, 0, 0, 25, 9, "busy", 12345, false)).toBe(expected(0, 0, 25, 9, phase));
});

test("figureColor uses actual W/H from a non-maximal frame", () => {
	// A 4×3 frame samples the gradient differently from a 25×9 one at the same cell.
	expect(figureColor(HUES, 1, 1, 4, 3, "idle", 0, false)).toBe(expected(1, 1, 4, 3, 0));
});

test("mood_shift on: the phase advances with wall-clock (drift)", () => {
	const a = figureColor(HUES, 5, 5, 25, 9, "idle", 0, true);
	const b = figureColor(HUES, 5, 5, 25, 9, "idle", SHIMMER_PERIOD_MS / 2, true);
	expect(a).not.toBe(b); // half a period later, a different gradient sample
});

test("mood_shift off: the gradient still drifts with wall-clock and adds no mood tint", () => {
	// Drift is independent of mood_shift: a later nowMs samples a different gradient phase.
	expect(figureColor(HUES, 5, 5, 25, 9, "idle", 0, false)).not.toBe(
		figureColor(HUES, 5, 5, 25, 9, "idle", SHIMMER_PERIOD_MS / 2, false),
	);
	// No tint when off: a mood (happy) matches idle at the same time, since the per-mood tint is suppressed.
	expect(figureColor(HUES, 5, 5, 25, 9, "happy", 999, false)).toBe(
		figureColor(HUES, 5, 5, 25, 9, "idle", 999, false),
	);
});

test("happy applies a warm static tint over the base gradient when mood_shift is on", () => {
	const plain = figureColor(HUES, 4, 4, 25, 9, "idle", 0, true);
	const warm = figureColor(HUES, 4, 4, 25, 9, "happy", 0, true);
	expect(warm).not.toBe(plain); // a tint moved the quantized index
});
