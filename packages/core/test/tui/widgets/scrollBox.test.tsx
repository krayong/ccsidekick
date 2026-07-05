import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement as h } from "react";

import { ScrollBox } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const lines = ["ABCDEFGHIJ", "1234567890", "row3xxxxxx", "row4yyyyyy", "row5zzzzzz"];
const content = lines.map((l, i) => h(Text, { key: i, wrap: "truncate" as const }, l));

// wrap="truncate" clips each line to the viewport width, appending an ellipsis when it overflows — a
// natural "more to the right" affordance for a horizontally scrollable box.
test("ScrollBox shows the top-left window at offset 0,0", () => {
	const frame =
		render(
			h(ScrollBox, { width: 5, height: 2, offsetX: 0, offsetY: 0, children: content }),
		).lastFrame() ?? "";
	const rows = frame.split("\n");
	expect(rows).toHaveLength(2); // clipped to height
	expect(rows[0]?.startsWith("ABCD")).toBe(true); // clipped to width (5th col is the ellipsis)
	expect(rows[1]?.startsWith("1234")).toBe(true);
});

test("ScrollBox scrolls vertically by offsetY", () => {
	const frame =
		render(
			h(ScrollBox, { width: 5, height: 2, offsetX: 0, offsetY: 2, children: content }),
		).lastFrame() ?? "";
	const rows = frame.split("\n");
	expect(rows[0]?.startsWith("row3")).toBe(true); // rows 0-1 scrolled off the top
	expect(rows[1]?.startsWith("row4")).toBe(true);
});

test("ScrollBox scrolls horizontally by offsetX", () => {
	const frame =
		render(
			h(ScrollBox, { width: 5, height: 2, offsetX: 3, offsetY: 0, children: content }),
		).lastFrame() ?? "";
	const rows = frame.split("\n");
	expect(rows[0]?.startsWith("DEFG")).toBe(true); // first 3 cols scrolled off the left
	expect(rows[1]?.startsWith("4567")).toBe(true);
});
