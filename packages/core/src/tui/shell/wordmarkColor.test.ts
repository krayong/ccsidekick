import { expect, test } from "bun:test";

import { xtermToRgb } from "../../render";

import { wordmarkColor } from "./wordmarkColor";

const HUES = [75, 147, 77, 222, 210] as const;

test("a cell landing on a stop returns that stop's color", () => {
	// x=0,y=0,phase=0 → t=0 → first stop (index 75), returned as its own xterm index.
	expect(wordmarkColor(HUES, 0, 0, 70, 6, 0)).toBe(75);
});

test("returns a renderable (non-system, non-grayscale) index for every cell", () => {
	for (let x = 0; x < 70; x++) {
		const idx = wordmarkColor(HUES, x, 3, 70, 6, 1234);
		expect(idx).toBeGreaterThanOrEqual(16);
		expect(idx).toBeLessThan(232);
	}
});

test("midpoints stay saturated (chroma above the RGB-blend muddy floor)", () => {
	// Halfway between green (77) and gold (222); HSV keeps it a vivid yellow-green, not olive.
	const idx = wordmarkColor([77, 222], 1, 0, 4, 1, 0);
	const [r, g, b] = xtermToRgb(idx);
	const chroma = Math.max(r, g, b) - Math.min(r, g, b);
	expect(chroma).toBeGreaterThan(60);
});

test("is deterministic for the same inputs", () => {
	expect(wordmarkColor(HUES, 4, 2, 70, 6, 999)).toBe(wordmarkColor(HUES, 4, 2, 70, 6, 999));
});
