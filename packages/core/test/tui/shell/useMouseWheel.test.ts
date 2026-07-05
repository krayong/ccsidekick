import { expect, test } from "bun:test";

import { parseMouseWheel } from "../../../src/tui/shell";

test("wheel up and down map to vertical deltas", () => {
	expect(parseMouseWheel("\x1b[<64;10;5M")).toEqual({ dx: 0, dy: -1 });
	expect(parseMouseWheel("\x1b[<65;10;5M")).toEqual({ dx: 0, dy: 1 });
});

test("wheel left and right map to horizontal deltas", () => {
	expect(parseMouseWheel("\x1b[<66;10;5M")).toEqual({ dx: -1, dy: 0 });
	expect(parseMouseWheel("\x1b[<67;10;5M")).toEqual({ dx: 1, dy: 0 });
});

test("multiple wheel events in one chunk aggregate", () => {
	expect(parseMouseWheel("\x1b[<65;1;1M\x1b[<65;1;1M\x1b[<65;1;1M")).toEqual({ dx: 0, dy: 3 });
});

test("a non-wheel button (a plain click) yields no delta", () => {
	expect(parseMouseWheel("\x1b[<0;10;5M")).toEqual({ dx: 0, dy: 0 });
});

test("ordinary keyboard input yields no delta", () => {
	expect(parseMouseWheel("ijkl")).toEqual({ dx: 0, dy: 0 });
});
