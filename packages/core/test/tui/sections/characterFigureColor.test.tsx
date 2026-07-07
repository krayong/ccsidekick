import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
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

const rosterState: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };
const detail = {
	ok: true,
	displayName: "Batman",
	figure: ["⣿⣿⣿", "⣿⣿⣿"],
	moods: ["idle"],
	artist: "Bob Kane",
	source: "src",
	tone: "edgy",
	emblem: "B",
} as const;

function base(over: Partial<CharacterSectionProps> = {}): CharacterSectionProps {
	return {
		state: rosterState,
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

test("the figure cells carry per-cell truecolor under full capability", () => {
	const frameRaw = render(createElement(CharacterSection, base())).lastFrame() ?? "";
	// Ink emits a truecolor SGR (\x1b[38;2;r;g;bm) for each colored glyph.
	expect(frameRaw).toContain("38;2;");
	// The glyphs survive the coloring.
	expect(frameRaw).toContain("⣿");
});

test("blank cells stay uncolored under non-full capability", () => {
	const noColorTokens = resolveTokens(THEMES.houston, detectCapability({ NO_COLOR: "1" }));
	const frameRaw =
		render(
			createElement(
				CharacterSection,
				base({ tokens: noColorTokens, detail: { ...detail, figure: ["⣿ ⣿"] } }),
			),
		).lastFrame() ?? "";
	expect(frameRaw).not.toContain("38;2;");
	expect(frameRaw).toContain("⣿ ⣿");
});
