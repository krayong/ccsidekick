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

const state: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };
const items: readonly MillerItem[] = [
	{ id: "a", label: "aaa" },
	{ id: "b", label: "bbb" },
	{ id: "c", label: "ccc" },
	{ id: "d", label: "ddd" },
];

test("the three-column rail draws its two interior rules down every content row", () => {
	const frame =
		render(
			createElement(Rail, {
				categories: ["Roster", "Browse"],
				items,
				detail: createElement(
					Box,
					{ flexDirection: "column" },
					createElement(Text, null, "d1"),
					createElement(Text, null, "d2"),
					createElement(Text, null, "d3"),
					createElement(Text, null, "d4"),
				),
				state,
				rows: 20,
				tokens,
				glyphs,
			}),
		).lastFrame() ?? "";
	// each of the 4 content rows must carry both interior vertical rules (2+ "│" per line)
	const twoRuleLines = frame.split("\n").filter((l) => (l.match(/│/g) ?? []).length >= 2).length;
	expect(twoRuleLines).toBeGreaterThanOrEqual(4);
});
