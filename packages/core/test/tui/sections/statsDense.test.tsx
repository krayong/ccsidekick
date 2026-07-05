import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { displayWidth } from "../../../src/render";
import { StatsSection, type StatsView } from "../../../src/tui/sections";
import { CONTENT_CHROME_COLS } from "../../../src/tui/shell";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";

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

const view: StatsView = {
	empty: false,
	groups: [
		{
			heading: "Volume",
			rows: [
				{ label: "Sessions", value: "142" },
				{ label: "Active days", value: "38" },
				{ label: "Streak", value: "6 / 11" },
				{ label: "Sess/day", value: "3.7" },
			],
		},
		{
			heading: "Time",
			rows: [
				{ label: "Median", value: "12m" },
				{ label: "Longest", value: "1h04" },
				{ label: "Total time", value: "22h" },
				{ label: "Peak hour", value: "21:00" },
			],
		},
	],
	entry: null,
	weekday: { label: "Weekday", value: "78%" },
	weekend: { label: "Weekend", value: "22%" },
	cost: { show: true, budgetRatio: 0.84, text: "$84.20 / $100" },
	heatmap: Array.from({ length: 60 }, (_, i) => i % 5),
	sparkline: Array.from({ length: 23 }, (_, i) => i % 8),
	models: [{ label: "opus", ratio: 0.72, caption: "$60" }],
};

test("the stat grid packs multiple stats onto one visual row at width", () => {
	const frame =
		render(
			createElement(StatsSection, {
				dimension: 0,
				windowIdx: 0,
				focus: 0,
				offsetX: 0,
				offsetY: 0,
				view,
				maxRows: 60,
				contentWidth: 90, // wide -> 4 columns
				tokens,
			}),
		).lastFrame() ?? "";
	const rowWithTwo = frame
		.split("\n")
		.some((l) => l.includes("Sessions") && l.includes("Active days"));
	expect(rowWithTwo).toBe(true);
});

test("at a narrow content width the grid drops columns and no line exceeds the width", () => {
	const frame =
		render(
			createElement(StatsSection, {
				dimension: 0,
				windowIdx: 0,
				focus: 0,
				offsetX: 0,
				offsetY: 0,
				view,
				maxRows: 60,
				contentWidth: 40, // narrow -> 2 columns (40 / CELL_WIDTH 20)
				tokens,
			}),
		).lastFrame() ?? "";
	// No rendered line's terminal column width may exceed the content width (nothing clipped off the right
	// frame). Measured with displayWidth, not raw .length: a colored line's ANSI SGR bytes inflate .length
	// without occupying a screen column, so a raw-length check would fail even on correctly wrapped output.
	const maxLine = Math.max(...frame.split("\n").map((l) => displayWidth(l)));
	expect(maxLine).toBeLessThanOrEqual(40);
});

test("at the 80x24 floor no stat cell is clipped: every grid label and value is present", () => {
	// Mirrors the Dashboard's own contentWidth formula (columns - CONTENT_CHROME_COLS) at the most common
	// terminal size, where a naive fixed 4-column x 20-wide grid would run off the right edge of the frame.
	const contentWidth = Math.max(20, 80 - CONTENT_CHROME_COLS);
	const frame =
		render(
			createElement(StatsSection, {
				dimension: 0,
				windowIdx: 0,
				focus: 0,
				offsetX: 0,
				offsetY: 0,
				view,
				maxRows: 60,
				contentWidth,
				tokens,
			}),
		).lastFrame() ?? "";
	for (const group of view.groups) {
		for (const row of group.rows) {
			expect(frame).toContain(row.label);
			expect(frame).toContain(row.value);
		}
	}
	const maxLine = Math.max(...frame.split("\n").map((l) => displayWidth(l)));
	expect(maxLine).toBeLessThanOrEqual(contentWidth);
});
