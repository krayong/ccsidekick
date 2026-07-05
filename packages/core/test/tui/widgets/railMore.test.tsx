import { afterEach, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { Rail, type MillerItem, type RailState } from "../../../src/tui/widgets";

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

const items: readonly MillerItem[] = Array.from({ length: 12 }, (_, i) => ({
	id: String(i),
	label: `item${String(i)}`,
}));
const state: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };

test("a windowed rail list shows a '▾ N more' hint that stays inside the fixed height", () => {
	// Wrap in a height-bounded, overflow-hidden parent (as AppShell does): if the list windowed to the
	// full `rows` and appended the hint as a rows+1 line, the parent would CLIP the hint away. It must
	// window to rows-1 and render the hint on the reserved last line, so it survives the clip.
	const frame =
		render(
			createElement(
				Box,
				{ height: 5, flexDirection: "column", overflow: "hidden" },
				createElement(Rail, {
					categories: ["A", "B"],
					items,
					detail: createElement(Box, null, createElement(Text, null, "d")),
					state,
					rows: 5,
					tokens,
					glyphs,
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("more");
	expect(frame).toContain("▾");
});

test("a fully visible rail list shows no hint", () => {
	const shortItems: readonly MillerItem[] = [
		{ id: "a", label: "Alpha" },
		{ id: "b", label: "Bravo" },
	];
	const frame =
		render(
			createElement(Rail, {
				categories: ["A", "B"],
				items: shortItems,
				detail: createElement(Box, null, createElement(Text, null, "d")),
				state,
				rows: 10,
				tokens,
				glyphs,
			}),
		).lastFrame() ?? "";
	expect(frame).not.toContain("more");
});
