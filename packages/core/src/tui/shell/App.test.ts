import { expect, test } from "bun:test";

import { THEMES } from "../../data";

import { pickTheme } from "./App";

test("a known theme name resolves to its ThemeData", () => {
	expect(pickTheme("nord")).toBe(THEMES.nord);
});

test("undefined resolves to houston", () => {
	expect(pickTheme(undefined)).toBe(THEMES.houston);
});

test("an unknown name falls back to houston", () => {
	expect(pickTheme("not-a-theme")).toBe(THEMES.houston);
});
