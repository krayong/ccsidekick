// packages/core/test/tui/widgets/sparkline.test.tsx
import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";
import { Sparkline } from "../../../src/tui/widgets";

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

test("the Sparkline peaks at the max value and floors the zeros", () => {
	const frame = render(createElement(Sparkline, { values: [0, 0, 5], tokens })).lastFrame() ?? "";
	expect(frame).toContain("█"); // the max
	expect(frame).toContain("▁"); // a zero day
});

test("the Sparkline floors an all-zero series", () => {
	const frame = render(createElement(Sparkline, { values: [0, 0, 0], tokens })).lastFrame() ?? "";
	expect(frame).toContain("▁");
	expect(frame).not.toContain("█");
});

test("a `days` prop of 60 slices the series to 60 values instead of 28", () => {
	const values = Array.from({ length: 70 }, (_, i) => (i === 69 ? 9 : 0));
	const frame = render(createElement(Sparkline, { values, tokens, days: 60 })).lastFrame() ?? "";
	// Index 69 falls outside the first 60 values, so no peak bar should render.
	expect(frame).not.toContain("█");
	expect(frame).toContain("▁");
});

test("the Sparkline colors from a theme data hue, not the accent hue", () => {
	const frame = render(createElement(Sparkline, { values: [0, 0, 5], tokens })).lastFrame() ?? "";
	const hue = tokens.dataHues[1] ?? "";
	const r = parseInt(hue.slice(1, 3), 16);
	const g = parseInt(hue.slice(3, 5), 16);
	const b = parseInt(hue.slice(5, 7), 16);
	expect(frame).toContain(`38;2;${String(r)};${String(g)};${String(b)}`);
});

test("the Sparkline still renders with no truecolor escapes under NO_COLOR", () => {
	const noColorTokens = resolveTokens(THEMES.houston, detectCapability({ NO_COLOR: "1" }));
	const frame =
		render(
			createElement(Sparkline, { values: [0, 0, 5], tokens: noColorTokens }),
		).lastFrame() ?? "";
	expect(frame).not.toContain("38;2;");
	expect(frame).toContain("█");
});
