import { expect, test } from "bun:test";

import { clampScroll } from "../../src/tui";

test("clampScroll keeps an in-range offset unchanged", () => {
	expect(clampScroll(2, 10, 5)).toBe(2); // content 10, viewport 5 -> max offset 5
});

test("clampScroll floors a negative offset at 0", () => {
	expect(clampScroll(-3, 10, 5)).toBe(0);
});

test("clampScroll caps at content minus viewport", () => {
	expect(clampScroll(99, 10, 5)).toBe(5);
});

test("clampScroll returns 0 when the content fits the viewport", () => {
	expect(clampScroll(4, 5, 8)).toBe(0);
	expect(clampScroll(4, 8, 8)).toBe(0);
});
