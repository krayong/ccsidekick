import { expect, test } from "bun:test";

import { KEYMAP } from "../../../src/tui/nav";

test("KEYMAP groups every binding under a known group", () => {
	const groups = new Set(["Navigate", "Find & preview", "Actions"]);
	expect(KEYMAP.length).toBeGreaterThan(0);
	for (const b of KEYMAP) expect(groups.has(b.group)).toBe(true);
});

test("KEYMAP advertises the keys the UI exposes", () => {
	const keys = KEYMAP.map((b) => b.keys).join(" ");
	for (const token of ["tab", "1-8", "↵", "esc", "/", "?", "ctrl+p", "ctrl+s", "q", "w a s d"]) {
		expect(keys).toContain(token);
	}
});
