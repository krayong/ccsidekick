import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import {
	StatsSection,
	statsBoardHeight,
	type StatsGroup,
	type StatsSectionProps,
	type StatsView,
} from "../../../src/tui/sections";
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

const fullGroups: readonly StatsGroup[] = [
	{
		heading: "Volume",
		rows: [
			{ label: "Sessions", value: "12" },
			{ label: "Active days", value: "5" },
			{ label: "Sessions/day", value: "2.4" },
			{ label: "Streak", value: "3d (best 7d)" },
		],
	},
	{
		heading: "Time",
		rows: [
			{ label: "Total time", value: "2h" },
			{ label: "Median session", value: "1m 30s" },
			{ label: "Longest session", value: "1h" },
		],
	},
	{
		heading: "Rhythm",
		rows: [
			{ label: "Peak hour", value: "14:00" },
			{ label: "Busiest weekday", value: "Tue" },
		],
	},
	{
		heading: "Highlights",
		rows: [
			{ label: "Median cost", value: "$0.42" },
			{ label: "Top project", value: "acme ($3.10)" },
			{ label: "Favorite character", value: "batman (8)" },
		],
	},
];

function baseView(over: Partial<StatsView> = {}): StatsView {
	const daily = Array.from({ length: 60 }, (_, i) => i % 5);
	return {
		empty: false,
		groups: fullGroups,
		entry: null,
		weekday: { label: "Weekday", value: "9 sessions · 1h 30m · $3.20" },
		weekend: { label: "Weekend", value: "3 sessions · 30m · $1.00" },
		cost: { show: true, budgetRatio: null, text: "$4.20" },
		heatmap: daily,
		sparkline: daily,
		models: [{ label: "sonnet", ratio: 0.7, caption: "$2.10 · 50k tok" }],
		...over,
	};
}

function base(over: Partial<StatsSectionProps> = {}): StatsSectionProps {
	return {
		dimension: 0,
		windowIdx: 0,
		focus: 0,
		view: baseView(),
		maxRows: 60, // tall enough that the whole board fits the scroll viewport, un-clipped
		contentWidth: 90, // 4 grid columns (90 / CELL_WIDTH 20)
		offsetX: 0,
		offsetY: 0,
		tokens,
		...over,
	};
}

test("StatsSection renders the axis rows, heatmap, grouped grid, weekday split, cost, and per-model bars", () => {
	const frame = render(createElement(StatsSection, base())).lastFrame() ?? "";
	expect(frame).toContain("View");
	expect(frame).toContain("Window");
	expect(frame).toContain("Overall");
	expect(frame).toContain("Character");
	expect(frame).toContain("All-time");
	expect(frame).toContain("Recent 30d");
	expect(frame).toContain("█"); // heatmap / sparkline
	expect(frame).toContain("60-day activity");
	// The group subheadings give the board its structure.
	expect(frame).toContain("Volume");
	expect(frame).toContain("Highlights");
	expect(frame).toContain("Sessions");
	expect(frame).toContain("Favorite character");
	expect(frame).toContain("batman (8)");
	// A regression check for the label/value gutter: "Favorite character" already exceeds the 12-wide pad
	// field, so the cell's own trailing space is what must survive (no "Favorite characterbatman" run-on).
	// eslint-disable-next-line no-control-regex -- stripping ANSI SGR codes to check plain-text spacing
	const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");
	expect(plain).toContain("Favorite character batman (8)");
	expect(frame).toContain("Weekday");
	expect(frame).toContain("Weekend");
	expect(frame).toContain("$4.20");
	expect(frame).toContain("sonnet");
});

test("StatsSection renders the '—' placeholder for nullable grid fields, never crashing", () => {
	const view = baseView({
		groups: [
			{
				heading: "Rhythm",
				rows: [
					{ label: "Peak hour", value: "—" },
					{ label: "Busiest weekday", value: "—" },
				],
			},
			{
				heading: "Highlights",
				rows: [
					{ label: "Top project", value: "—" },
					{ label: "Favorite character", value: "—" },
				],
			},
		],
	});
	const frame = render(createElement(StatsSection, base({ view }))).lastFrame() ?? "";
	expect(frame).toContain("—");
	expect(frame).not.toContain("null");
});

test("StatsSection shows the empty line and hides the board when empty", () => {
	const frame =
		render(
			createElement(StatsSection, base({ view: baseView({ empty: true }) })),
		).lastFrame() ?? "";
	expect(frame.toLowerCase()).toContain("no sessions yet");
	expect(frame).not.toContain("█");
	expect(frame).not.toContain("$4.20");
});

test("StatsSection keeps the View/Window axis rows visible even when the board is empty", () => {
	const frame =
		render(
			createElement(StatsSection, base({ view: baseView({ empty: true }) })),
		).lastFrame() ?? "";
	expect(frame).toContain("Overall");
	expect(frame).toContain("All-time");
});

test("StatsSection marks the focused axis row and its active value pill", () => {
	// Focus on Window (row 1) with Recent 30d active: the Window label carries the focus marker, and the
	// active window value is bracketed.
	const frame =
		render(createElement(StatsSection, base({ focus: 1, windowIdx: 1 }))).lastFrame() ?? "";
	// eslint-disable-next-line no-control-regex -- strip ANSI SGR codes to check the plain-text markers
	const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");
	const windowRow = plain.split("\n").find((l) => l.includes("Window")) ?? "";
	expect(windowRow).toContain("›"); // the focus marker
	expect(windowRow).toContain("[Recent 30d]"); // the active value bracketed
});

test("StatsSection shows the entry switcher row for a Character dimension with entries", () => {
	const view = baseView({ entry: { key: "batman", index: 0, count: 3 } });
	const frame =
		render(createElement(StatsSection, base({ dimension: 2, focus: 2, view }))).lastFrame() ??
		"";
	expect(frame).toContain("Character");
	expect(frame).toContain("batman");
	expect(frame).toContain("1 / 3");
});

test("StatsSection shows a no-entries line for a Character dimension with no entries", () => {
	const view = baseView({ entry: null, empty: true });
	const frame =
		render(createElement(StatsSection, base({ dimension: 2, view }))).lastFrame() ?? "";
	expect(frame.toLowerCase()).toContain("no characters yet");
});

test("StatsSection hides the cost block when cost.show is false", () => {
	const view = baseView({ cost: { show: false, budgetRatio: null, text: "$4.20" } });
	const frame =
		render(createElement(StatsSection, base({ dimension: 2, view }))).lastFrame() ?? "";
	expect(frame).not.toContain("Cost");
	expect(frame).not.toContain("$4.20");
});

// The board no longer degrades: it renders in full inside a scroll viewport. At a tall budget everything shows;
// at a short budget the board clips to the viewport and the pinned axis rows stay visible, while the vertical
// offset scrolls the board so lower content (the per-model bars at the bottom) comes into view.
test("StatsSection renders the whole board at a tall budget", () => {
	const full = render(createElement(StatsSection, base({ maxRows: 60 }))).lastFrame() ?? "";
	expect(full).toContain("60-day activity"); // heatmap
	expect(full).toContain("Favorite character"); // last group
	expect(full).toContain("sonnet"); // per-model bar at the bottom
});

test("StatsSection clips the board to a short budget but keeps the axis rows pinned", () => {
	const frame =
		render(createElement(StatsSection, base({ maxRows: 8, offsetY: 0 }))).lastFrame() ?? "";
	expect(frame).toContain("View"); // axis rows pinned
	expect(frame).toContain("Window");
	expect(frame).not.toContain("sonnet"); // bottom of the board is clipped below the fold
});

test("StatsSection scrolls the board vertically to reveal clipped content", () => {
	// Bottom-align the viewport: offset = full board height minus the visible board rows (maxRows 8, minus 2
	// axis rows and the board's 1-row top margin -> a 5-row viewport).
	const bottom = statsBoardHeight(baseView(), 90) - 5;
	const top =
		render(createElement(StatsSection, base({ maxRows: 8, offsetY: 0 }))).lastFrame() ?? "";
	const scrolled =
		render(createElement(StatsSection, base({ maxRows: 8, offsetY: bottom }))).lastFrame() ??
		"";
	expect(top).not.toBe(scrolled); // scrolling changed the visible window
	expect(scrolled).toContain("View"); // axis rows stay pinned while scrolled
	expect(scrolled).toContain("sonnet"); // the bottom of the board is now in view
});

test("StatsSection colors the board with more than one hue from the theme's data-hue ramp", () => {
	const view = baseView({
		models: [
			{ label: "sonnet", ratio: 0.7, caption: "$2.10 · 50k tok" },
			{ label: "opus", ratio: 0.3, caption: "$1.10 · 20k tok" },
		],
	});
	const frame = render(createElement(StatsSection, base({ view }))).lastFrame() ?? "";
	const colors = new Set(frame.match(/38;2;\d+;\d+;\d+/g) ?? []);
	expect(colors.size).toBeGreaterThan(1);
});

test("StatsSection still renders under NO_COLOR with no truecolor escapes", () => {
	const noColorTokens = resolveTokens(THEMES.houston, detectCapability({ NO_COLOR: "1" }));
	const view = baseView({
		models: [
			{ label: "sonnet", ratio: 0.7, caption: "$2.10 · 50k tok" },
			{ label: "opus", ratio: 0.3, caption: "$1.10 · 20k tok" },
		],
	});
	const frame =
		render(createElement(StatsSection, base({ view, tokens: noColorTokens }))).lastFrame() ??
		"";
	expect(frame).not.toContain("38;2;");
	expect(frame).toContain("sonnet");
	expect(frame).toContain("opus");
});
