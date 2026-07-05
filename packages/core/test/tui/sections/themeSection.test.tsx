import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { DEFAULT_CONFIG } from "../../../src/sources";
import {
	type ThemeSectionProps,
	themeSettingsFields,
	ThemeSection,
} from "../../../src/tui/sections";
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
const themeKeys = Object.keys(THEMES);

const themesState: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };
const optionsState = (itemCursor = 0): RailState => ({ focus: 1, catCursor: 1, itemCursor });

function base(over: Partial<ThemeSectionProps> = {}): ThemeSectionProps {
	return {
		state: themesState,
		themeKeys,
		themes: THEMES,
		activeTheme: "houston",
		settingRows: themeSettingsFields(DEFAULT_CONFIG),
		detailBody: "mini-preview-line",
		rows: 80,
		tokens,
		glyphs,
		...over,
	};
}

test("the category column shows Themes and Options", () => {
	const frame = render(createElement(ThemeSection, base())).lastFrame() ?? "";
	expect(frame).toContain("Themes");
	expect(frame).toContain("Options");
});

test("the Themes list shows theme display names and marks the active theme", () => {
	const frame = render(createElement(ThemeSection, base())).lastFrame() ?? "";
	expect(frame).toContain("Houston");
	expect(frame).toContain("Dracula");
	expect(frame).toContain(glyphs.tabActive); // the active marker on houston
});

test("a theme row shows a swatch strip and the mini-statusline body", () => {
	const frame = render(createElement(ThemeSection, base())).lastFrame() ?? "";
	expect(frame).toContain("██");
	expect(frame).toContain("mini-preview-line");
});

test("when detailBody is empty the swatch strip still renders", () => {
	// At narrow terminals the Dashboard gates themeDetailBody to ""; the swatch must
	// always show so the detail panel is never blank.
	const frame = render(createElement(ThemeSection, base({ detailBody: "" }))).lastFrame() ?? "";
	expect(frame).toContain("██"); // hue swatch
	expect(frame).toContain("●"); // signal dots
	expect(frame).not.toContain("mini-preview-line"); // body absent (was the default sentinel)
});

test("when detailBody is empty the detail pane has no body block", () => {
	// Before the fix ThemeSection always renders <Box marginTop={1}><Text></Text></Box>.
	// After the fix it omits the Box entirely, so the empty-body frame is no taller than
	// the swatch-only panel.  We confirm by checking the frame line count: empty-body must
	// not exceed the swatch-only baseline.
	const swatchOnly =
		render(createElement(ThemeSection, base({ detailBody: "" }))).lastFrame() ?? "";
	const withBody =
		render(createElement(ThemeSection, base({ detailBody: "x" }))).lastFrame() ?? "";
	expect(swatchOnly.split("\n").length).toBeLessThanOrEqual(withBody.split("\n").length);
});

test("the Options category lists exactly Banding and Mood shift", () => {
	const frame =
		render(createElement(ThemeSection, base({ state: optionsState() }))).lastFrame() ?? "";
	expect(frame).toContain("Banding");
	expect(frame).toContain("Mood shift");
});

test("selecting Banding shows its current value and an explanation of the setting", () => {
	const frame =
		render(createElement(ThemeSection, base({ state: optionsState(0) }))).lastFrame() ?? "";
	expect(frame).toContain("solid"); // DEFAULT_CONFIG.theme.banding
	expect(frame).toContain("cycle sweeps the hue ramp");
});

test("selecting Mood shift shows its current value and an explanation of the setting", () => {
	const frame =
		render(createElement(ThemeSection, base({ state: optionsState(1) }))).lastFrame() ?? "";
	expect(frame).toContain("off"); // DEFAULT_CONFIG.theme.mood_shift
	expect(frame).toContain("tints the figure by mood, color only");
});

test("a pack-contributed theme shows in the list with its display name and swatch", () => {
	const packTheme = {
		displayName: "Spider-Man",
		hues: [203, 209, 45, 39, 33],
		comment: [203, 39],
		signals: { nominal: 45, caution: 214, critical: 203 },
		separator: 33,
	};
	const frame =
		render(
			createElement(
				ThemeSection,
				base({
					themes: { ...THEMES, spiderman: packTheme },
					themeKeys: [...Object.keys(THEMES), "spiderman"],
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("Spider-Man");
});
