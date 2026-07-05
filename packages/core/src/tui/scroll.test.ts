import { expect, test } from "bun:test";

import { scrollWindow } from "./scroll";

test("total <= viewport returns the whole range", () => {
	expect(scrollWindow(3, 1, 5)).toEqual({ start: 0, end: 3 });
	expect(scrollWindow(5, 4, 5)).toEqual({ start: 0, end: 5 });
	expect(scrollWindow(0, 0, 5)).toEqual({ start: 0, end: 0 });
});

test("cursor near the top pins the window to the start", () => {
	expect(scrollWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
	expect(scrollWindow(20, 1, 5)).toEqual({ start: 0, end: 5 });
});

test("cursor in the middle centers the window", () => {
	expect(scrollWindow(20, 10, 5)).toEqual({ start: 8, end: 13 });
});

test("cursor near the bottom pins the window to the end", () => {
	expect(scrollWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
	expect(scrollWindow(20, 18, 5)).toEqual({ start: 15, end: 20 });
});

test("viewport of 1 follows the cursor exactly", () => {
	expect(scrollWindow(10, 0, 1)).toEqual({ start: 0, end: 1 });
	expect(scrollWindow(10, 5, 1)).toEqual({ start: 5, end: 6 });
	expect(scrollWindow(10, 9, 1)).toEqual({ start: 9, end: 10 });
});

test("viewport floors at 1 and the cursor is clamped into range", () => {
	expect(scrollWindow(10, 5, 0)).toEqual({ start: 5, end: 6 });
	expect(scrollWindow(10, 99, 3)).toEqual({ start: 7, end: 10 });
});
