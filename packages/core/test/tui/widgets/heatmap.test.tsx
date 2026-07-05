// packages/core/test/tui/widgets/heatmap.test.tsx
import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";
import { Heatmap, levelOf } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const tokens = resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" }));

// Unit tests for the pure ramp helper (spec §17).
test("levelOf returns 0 for zero sessions", () => {
	expect(levelOf(0, 10)).toBe(0);
});

test("levelOf returns 4 for the max session count", () => {
	expect(levelOf(10, 10)).toBe(4);
});

test("levelOf returns 1..4 for a mid session count", () => {
	const level = levelOf(5, 10);
	expect(level).toBeGreaterThanOrEqual(1);
	expect(level).toBeLessThanOrEqual(4);
});

test("the Heatmap draws a 4-row grid, a legend, and full intensity for the busiest day", () => {
	const cells = Array.from({ length: 28 }, (_, i) => (i === 27 ? 9 : 0));
	const frame = render(createElement(Heatmap, { cells, tokens })).lastFrame() ?? "";
	expect(frame).toContain("██"); // data cells are doubled; the max cell produces "██"
	expect(frame.toLowerCase()).toContain("less");
	expect(frame.toLowerCase()).toContain("more");
	// 4 grid rows + 1 legend row.
	expect(frame.split("\n").length).toBeGreaterThanOrEqual(5);
});

test("the Heatmap renders even when every day is empty", () => {
	const frame =
		render(
			createElement(Heatmap, { cells: new Array<number>(28).fill(0), tokens }),
		).lastFrame() ?? "";
	expect(frame).toContain("·"); // the level-0 glyph
	// Data cells are doubled; "██" only appears when a cell reaches level 4.
	// The legend renders each glyph singly, so a single "█" is present but "██" is not.
	expect(frame).not.toContain("██");
});

test("a `days` prop of 60 sizes the grid to 9 rows and names the legend", () => {
	const cells = Array.from({ length: 60 }, (_, i) => (i === 59 ? 9 : 0));
	const frame = render(createElement(Heatmap, { cells, tokens, days: 60 })).lastFrame() ?? "";
	expect(frame).toContain("60-day activity");
	// 9 grid rows (ceil(60/7)) + 1 legend row.
	expect(frame.split("\n").length).toBeGreaterThanOrEqual(10);
});

test("the Heatmap anchors its busiest-day color on a theme data hue, not the accent hue", () => {
	const cells = Array.from({ length: 28 }, (_, i) => (i === 27 ? 9 : 0));
	const frame = render(createElement(Heatmap, { cells, tokens })).lastFrame() ?? "";
	const hue = tokens.dataHues[0] ?? "";
	const r = parseInt(hue.slice(1, 3), 16);
	const g = parseInt(hue.slice(3, 5), 16);
	const b = parseInt(hue.slice(5, 7), 16);
	expect(frame).toContain(`38;2;${String(r)};${String(g)};${String(b)}`);
});

test("the Heatmap still renders with no truecolor escapes under NO_COLOR", () => {
	const noColorTokens = resolveTokens(THEMES.houston, detectCapability({ NO_COLOR: "1" }));
	const cells = Array.from({ length: 28 }, (_, i) => (i === 27 ? 9 : 0));
	const frame =
		render(createElement(Heatmap, { cells, tokens: noColorTokens })).lastFrame() ?? "";
	expect(frame).not.toContain("38;2;");
	expect(frame).toContain("██");
});
