import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { type FindPopupProps, FindPopup } from "../../../src/tui/widgets";

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
const glyphs = glyphSet(false);

function base(over: Partial<FindPopupProps> = {}): FindPopupProps {
	return {
		query: "th",
		rows: [
			{ id: "section:1", label: "Theme" },
			{ id: "section:5", label: "Statusline" },
		],
		cursor: 0,
		columns: 100,
		termRows: 24,
		tokens,
		glyphs,
		...over,
	};
}

test("the Find popup is titled and shows the query with a caret", () => {
	const frame = render(createElement(FindPopup, base())).lastFrame() ?? "";
	expect(frame).toContain("Find");
	expect(frame).toContain("/th█");
});

test("the Find popup marks the cursor row and lists the ranked results", () => {
	const frame = render(createElement(FindPopup, base({ cursor: 1 }))).lastFrame() ?? "";
	const line = frame.split("\n").find((l) => l.includes("Statusline")) ?? "";
	expect(line).toContain(glyphs.marker);
	expect(frame).toContain("Theme");
});

test("the Find popup shows a no-matches line when rows is empty", () => {
	const frame = render(createElement(FindPopup, base({ rows: [] }))).lastFrame() ?? "";
	expect(frame.toLowerCase()).toContain("no matches");
});

test("the Find popup footer advertises jump and close", () => {
	const frame = render(createElement(FindPopup, base())).lastFrame() ?? "";
	expect(frame).toContain("↵ jump");
	expect(frame).toContain("esc close");
});

test("the Find popup windows a tall list so a cursor far down the list stays visible", () => {
	const rows = Array.from({ length: 60 }, (_, i) => ({ id: `row:${i}`, label: `Row ${i}` }));
	const frame =
		render(createElement(FindPopup, base({ rows, cursor: 50, termRows: 20 }))).lastFrame() ??
		"";
	expect(frame).toContain("Row 50");
	const line = frame.split("\n").find((l) => l.includes("Row 50")) ?? "";
	expect(line).toContain(glyphs.marker);
	expect(frame.split("\n").length).toBeLessThanOrEqual(20);
});
