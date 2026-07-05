import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { Miller } from "../../../src/tui/widgets";

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
const detail = createElement(Text, null, "DETAIL-PANE");
const items = [
	{ id: "a", label: "Alpha" },
	{ id: "b", label: "Bravo" },
	{ id: "c", label: "Charlie" },
];

test("the list renders items, marks the cursor row, and shows the detail node", () => {
	const frame =
		render(
			createElement(Miller, { items, cursor: 1, detail, rows: 10, tokens, glyphs }),
		).lastFrame() ?? "";
	expect(frame).toContain("Alpha");
	expect(frame).toContain("Bravo");
	expect(frame).toContain("DETAIL-PANE");
	expect(frame).toContain(`${glyphs.marker} Bravo`); // the cursor row carries the marker glyph
});

test("a long list is windowed around the cursor", () => {
	const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: `Item${i}` }));
	const frame =
		render(
			createElement(Miller, { items: many, cursor: 20, detail, rows: 5, tokens, glyphs }),
		).lastFrame() ?? "";
	expect(frame).toContain("Item20");
	expect(frame).not.toContain("Item0"); // far-away rows are outside the window
});
