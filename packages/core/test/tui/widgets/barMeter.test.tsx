// packages/core/test/tui/widgets/barMeter.test.tsx
import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";
import { BarMeter } from "../../../src/tui/widgets";

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

test("the BarMeter fills proportionally and shows the label and caption", () => {
	const frame =
		render(
			createElement(BarMeter, {
				label: "Sessions",
				ratio: 0.5,
				caption: "10",
				tokens,
				width: 10,
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("Sessions");
	expect(frame).toContain("10");
	expect((frame.match(/█/g) ?? []).length).toBe(5); // half of width 10
});

test("the BarMeter clamps an out-of-range ratio to the full bar", () => {
	const frame =
		render(
			createElement(BarMeter, { label: "x", ratio: 2, caption: "", tokens, width: 4 }),
		).lastFrame() ?? "";
	expect((frame.match(/█/g) ?? []).length).toBe(4);
});

test("the BarMeter separates a long label from the bar with a space", () => {
	const frame =
		render(
			createElement(BarMeter, {
				label: "claude-opus-4-8", // 15 display cols, over the 14-col pad budget
				ratio: 0.5,
				caption: "10",
				tokens,
				width: 10,
			}),
		).lastFrame() ?? "";
	expect(frame).toMatch(/claude-opus-4-8 [\s\S]*█/); // a real space before the (ANSI-colored) bar
});

test("the BarMeter treats a non-finite ratio as empty", () => {
	const frame =
		render(
			createElement(BarMeter, {
				label: "x",
				ratio: Number.NaN,
				caption: "",
				tokens,
				width: 4,
			}),
		).lastFrame() ?? "";
	expect(frame).not.toContain("█");
});

test("the BarMeter paints its fill with a provided color instead of the theme accent", () => {
	const frame =
		render(
			createElement(BarMeter, {
				label: "x",
				ratio: 1,
				caption: "",
				tokens,
				width: 4,
				color: "#112233",
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("38;2;17;34;51");
});

test("the BarMeter keeps the theme accent color when no color prop is given", () => {
	const frame =
		render(
			createElement(BarMeter, { label: "x", ratio: 1, caption: "", tokens, width: 4 }),
		).lastFrame() ?? "";
	const accentHue = tokens.accent.color ?? "";
	const r = parseInt(accentHue.slice(1, 3), 16);
	const g = parseInt(accentHue.slice(3, 5), 16);
	const b = parseInt(accentHue.slice(5, 7), 16);
	expect(frame).toContain(`38;2;${String(r)};${String(g)};${String(b)}`);
});
