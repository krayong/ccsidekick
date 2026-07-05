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

const rosterState: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };
const browseState = (itemCursor = 0): RailState => ({ focus: 1, catCursor: 1, itemCursor });

function base(over: Partial<CharacterSectionProps> = {}): CharacterSectionProps {
	return {
		state: rosterState,
		packs: ["batman"],
		installed: ["batman"],
		activeIds: ["batman"],
		mode: "random",
		detail,
		installStatus: "idle",
		rows: 40,
		tokens,
		glyphs,
		hues: [75, 147, 77, 222, 210],
		nowMs: 0,
		moodShift: false,
		...over,
	};
}

test("the category column shows the category columns and the figure", () => {
	const frame = render(createElement(CharacterSection, base())).lastFrame() ?? "";
	expect(frame).toContain("Roster");
	expect(frame).toContain("Browse");
	// The figure is now painted per-cell (each glyph wrapped in its own color escape), so match it with the
	// ANSI stripped rather than as a contiguous colored substring.
	expect(stripAnsi(frame)).toContain("(batman)");
});

test("the Roster detail is name, a blank line, then the figure. no metadata lines", () => {
	const frame = render(createElement(CharacterSection, base())).lastFrame() ?? "";
	// Per-cell coloring wraps each glyph in its own escape, so match the figure with ANSI stripped.
	expect(stripAnsi(frame)).toContain("(batman)"); // figure still present
	expect(frame).not.toContain("roster 2"); // metadata removed
	expect(frame).not.toContain("tone edgy");
	expect(frame).not.toContain("Bob Kane");
});

test("the Roster list leads with a Mode row showing the current mode", () => {
	const frame =
		render(createElement(CharacterSection, base({ mode: "random" }))).lastFrame() ?? "";
	expect(frame).toContain("Mode");
	expect(frame).toContain("random");
	const fixed =
		render(createElement(CharacterSection, base({ mode: "fixed" }))).lastFrame() ?? "";
	expect(fixed).toContain("fixed");
});

test("an empty Browse category shows the no-other-packs line", () => {
	const frame =
		render(createElement(CharacterSection, base({ state: browseState() }))).lastFrame() ?? "";
	expect(frame).toContain("no other packs available");
});

test("Browse offers an uninstalled first-party pack (not the empty fallback)", () => {
	const frame =
		render(
			createElement(
				CharacterSection,
				base({
					state: browseState(1),
					packs: ["batman", "spiderman"],
					installed: ["batman"],
					detail: { ...detail, displayName: "Spider-Man", ok: false, figure: [] },
				}),
			),
		).lastFrame() ?? "";
	expect(frame).not.toContain("no other packs available");
	expect(frame).toContain("spiderman");
	expect(frame.toLowerCase()).toContain("install");
});

test("Browse lists an installable pack with an install affordance", () => {
	const frame =
		render(
			createElement(
				CharacterSection,
				base({
					state: browseState(1),
					packs: ["batman", "robin"],
					installed: ["batman"],
					detail: { ...detail, displayName: "Robin", ok: false, figure: [] },
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("robin");
	expect(frame.toLowerCase()).toContain("install");
});

test("an installing Browse pack renders the spinner label", () => {
	const frame =
		render(
			createElement(
				CharacterSection,
				base({
					state: browseState(1),
					packs: ["batman", "robin"],
					installed: ["batman"],
					installStatus: "installing",
					detail: { ...detail, displayName: "Robin", ok: false, figure: [] },
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("Installing");
});

test("reducedMotion collapses the install Spinner to a static line", () => {
	// The static ellipsis label (Installing…) is distinct from the Spinner's ASCII label (Installing...).
	const frame =
		render(
			createElement(
				CharacterSection,
				base({
					state: browseState(1),
					packs: ["batman", "robin"],
					installed: ["batman"],
					installStatus: "installing",
					reducedMotion: true,
					detail: { ...detail, displayName: "Robin", ok: false, figure: [] },
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("Installing…");
});

test("a Browse install error surfaces the message", () => {
	const frame =
		render(
			createElement(
				CharacterSection,
				base({
					state: browseState(1),
					packs: ["batman", "robin"],
					installed: ["batman"],
					installStatus: "error",
					errorMsg: "npm exploded",
					detail: { ...detail, displayName: "Robin", ok: false, figure: [] },
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("npm exploded");
});
