import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { stripAnsi } from "../../../src/render";
import { CharacterSection, type CharacterSectionProps } from "../../../src/tui/sections";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import type { RailState } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const tokens = resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" }));
const glyphs = glyphSet(false);
const detail = {
	ok: true,
	displayName: "Batman",
	figure: ["(batman)"],
	moods: ["idle", "busy"],
	artist: "Bob Kane",
	source: "https://example",
	tone: "edgy",
	emblem: "B",
} as const;

const modeState: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };
const rosterCat: RailState = { focus: 1, catCursor: 1, itemCursor: 0 };

function base(over: Partial<CharacterSectionProps> = {}): CharacterSectionProps {
	return {
		state: modeState,
		packs: ["batman"],
		activeIds: ["batman"],
		mode: "random",
		detail,
		rows: 40,
		tokens,
		glyphs,
		hues: [75, 147, 77, 222, 210],
		nowMs: 0,
		moodShift: false,
		...over,
	};
}

test("the Mode and Roster categories and the figure render", () => {
	const frame = render(createElement(CharacterSection, base())).lastFrame() ?? "";
	expect(frame).toContain("Mode");
	expect(frame).toContain("Roster");
	// The figure is now painted per-cell (each glyph wrapped in its own color escape), so match it with the
	// ANSI stripped rather than as a contiguous colored substring.
	expect(stripAnsi(frame)).toContain("(batman)");
});

test("there is no Browse category", () => {
	const frame = render(createElement(CharacterSection, base())).lastFrame() ?? "";
	expect(frame).not.toContain("Browse");
});

test("the detail is the figure with no metadata lines", () => {
	const frame =
		render(createElement(CharacterSection, base({ state: rosterCat }))).lastFrame() ?? "";
	// Per-cell coloring wraps each glyph in its own escape, so match the figure with ANSI stripped.
	expect(stripAnsi(frame)).toContain("(batman)"); // figure still present
	expect(frame).not.toContain("tone edgy");
	expect(frame).not.toContain("Bob Kane");
});

test("the Mode category lists fixed and random", () => {
	const frame =
		render(createElement(CharacterSection, base({ mode: "random" }))).lastFrame() ?? "";
	expect(frame).toContain("random");
	expect(frame).toContain("fixed");
});

test("the Roster category lists all bundled packs", () => {
	const frame =
		render(
			createElement(
				CharacterSection,
				base({ state: rosterCat, packs: ["batman", "spiderman"] }),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("batman");
	expect(frame).toContain("spiderman");
});
