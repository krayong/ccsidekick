import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { displayWidth, stripAnsi } from "../../../src/render";
import { type PreviewPanelProps, PreviewPanel } from "../../../src/tui/preview";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";
import { popupTextWidth } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const base = (over: Partial<PreviewPanelProps>): PreviewPanelProps => ({
	label: "Team",
	body: "ccsidekick preview line",
	columns: 80,
	rows: 24,
	index: 6,
	count: 12,
	noColor: false,
	narrow: false,
	tokens: resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" })),
	...over,
});

test("the panel shows the title, scenario label, position, and body", () => {
	const frame = render(createElement(PreviewPanel, base({}))).lastFrame() ?? "";
	expect(frame).toContain("Preview");
	expect(frame).toContain("Team");
	expect(frame).toContain("7/12"); // index+1 / count
	expect(frame).toContain("ccsidekick preview line");
});

test("the panel footer lists the scenario/color/width/close controls", () => {
	const frame = render(createElement(PreviewPanel, base({}))).lastFrame() ?? "";
	expect(frame).toContain(",");
	expect(frame).toContain(".");
	expect(frame.toLowerCase()).toContain("color");
	expect(frame.toLowerCase()).toContain("width");
	expect(frame.toLowerCase()).toContain("close");
});

test("the footer's width control is w, not m", () => {
	const frame = render(createElement(PreviewPanel, base({}))).lastFrame() ?? "";
	expect(frame).toContain("w width");
	expect(frame).not.toContain("m width");
});

test("the header never mashes the label into the position, even when the title has to shrink to fit", () => {
	// A long label plus a two-digit position/flags meta at a narrow popup width is exactly the case that
	// used to wrap the title into the meta's row, producing a run-on like "...yo11/12" with no separator
	// between the label's tail and the position.
	const frame =
		render(
			createElement(
				PreviewPanel,
				base({ label: "Pay as you go", columns: 48, index: 10, count: 12, narrow: true }),
			),
		).lastFrame() ?? "";
	const header =
		stripAnsi(frame)
			.split("\n")
			.find((l) => l.includes("Preview")) ?? "";
	expect(header).not.toMatch(/[a-z]\d/i); // no letter runs directly into a digit anywhere in the header
	expect(header).toContain("11/12");
	expect(header).toContain("·");
});

test("the header keeps the full label and meta cleanly separated when there is room", () => {
	const frame =
		render(
			createElement(PreviewPanel, base({ label: "Pay as you go", index: 10, count: 12 })),
		).lastFrame() ?? "";
	const header =
		stripAnsi(frame)
			.split("\n")
			.find((l) => l.includes("Preview")) ?? "";
	expect(header).toContain("Preview — Pay as you go");
	expect(header).toContain("11/12 · color · wide");
});

test("a body sized to the popup's inner text width renders each line intact without wrapping", () => {
	// The Popup frame is pinned to columns - POPUP_CHROME_COLS, with its own border (2) + paddingX (2)
	// eaten from that — `popupTextWidth` is that budget. A body built to exactly that width must fit
	// on one row. If the body were rendered at full `columns` width instead, Ink would wrap each line
	// and the trailing "B" marker would land on the next row, failing the assertion.
	const columns = 60;
	const inner = popupTextWidth(columns);
	const sentinel = `A${"X".repeat(inner - 2)}B`; // exactly `inner` chars; "B" is the wrap detector
	const body = [sentinel, sentinel, sentinel].join("\n");
	const frame = render(createElement(PreviewPanel, base({ columns, body }))).lastFrame() ?? "";
	expect(frame).toContain(sentinel);
});

test("a body line wider than the inner text budget (with a wide glyph) is clipped, and the frame stays pinned", () => {
	const columns = 60;
	const inner = popupTextWidth(columns);
	// Far wider than `inner`, and built from a double-width glyph so plain-length slicing (as opposed
	// to display-width-aware truncation) would get the cut point wrong.
	const overWide = "🌿".repeat(inner);
	const short = "hi";
	const frameWidth = (body: string): number => {
		const frame =
			render(createElement(PreviewPanel, base({ columns, body }))).lastFrame() ?? "";
		const border = frame.split("\n").find((l) => l.includes("╭")) ?? "";
		return displayWidth(border);
	};
	// The frame's own width does not grow to accommodate the over-wide line.
	expect(frameWidth(overWide)).toBe(frameWidth(short));
	// The rendered body itself never carries more than `inner` display columns of glyph content (each
	// 🌿 is display-width 2), regardless of the border/padding/centering columns around it.
	const frame =
		render(createElement(PreviewPanel, base({ columns, body: overWide }))).lastFrame() ?? "";
	const bodyLine = frame.split("\n").find((l) => l.includes("🌿")) ?? "";
	const glyphCount = (bodyLine.match(/🌿/gu) ?? []).length;
	expect(glyphCount * 2).toBeLessThanOrEqual(inner);
});
