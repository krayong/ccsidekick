import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { Rail, type RailState } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const tokens = resolveTokens(THEMES.houston, detectCapability({ NO_COLOR: "1" }));
const glyphs = glyphSet(false);
const categories = ["Character", "Theme"];
const items = [
	{ id: "a", label: "Alpha" },
	{ id: "b", label: "Bravo" },
];
const detail = createElement(Text, null, "DETAIL-PANE");

test("all three columns render: a category, an item, and the detail node", () => {
	const state: RailState = { focus: 1, catCursor: 0, itemCursor: 1 };
	const frame =
		render(
			createElement(Rail, { categories, items, detail, state, rows: 10, tokens, glyphs }),
		).lastFrame() ?? "";
	expect(frame).toContain("Character");
	expect(frame).toContain("Bravo");
	expect(frame).toContain("DETAIL-PANE");
});

test("the focused column's cursor row carries the marker; a non-focused column's selection is unmarked", () => {
	const state: RailState = { focus: 1, catCursor: 0, itemCursor: 1 };
	const frame =
		render(
			createElement(Rail, { categories, items, detail, state, rows: 10, tokens, glyphs }),
		).lastFrame() ?? "";
	expect(frame).toContain(`${glyphs.marker} Bravo`); // list is focused: its cursor row carries the marker
	expect(frame).not.toContain(`${glyphs.marker} Character`); // category isn't focused: no marker on its row
});
