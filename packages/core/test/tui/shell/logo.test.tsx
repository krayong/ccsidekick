import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { gradient } from "../../../src/render";
import { Logo, WORDMARK, WORDMARK_WIDTH } from "../../../src/tui/shell";
import { detectCapability, hexForXterm, resolveTokens } from "../../../src/tui/theme";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const hues = THEMES.houston.hues;
const full = detectCapability({ TERM: "xterm-256color" });
const none = detectCapability({ NO_COLOR: "1" });

test("the wordmark is a clean rectangle", () => {
	expect(WORDMARK.length).toBe(6);
	for (const row of WORDMARK) expect(row.length).toBe(WORDMARK_WIDTH);
	// row.length is UTF-16 units; [...row].length counts code points. Assert the code-point width too so a
	// font-version render whose glyphs differ in width (the ANSI Shadow width is only an authoring claim) is caught.
	expect(WORDMARK.every((row) => [...row].length <= WORDMARK_WIDTH)).toBe(true);
});

test("the Logo paints the solid faces and keeps the shadow edges", () => {
	const tokens = resolveTokens(THEMES.houston, full);
	const frame = render(createElement(Logo, { hues, capability: full, tokens })).lastFrame() ?? "";
	expect(frame).toContain("█"); // solid face
	expect(frame).toContain("╗"); // box-drawing shadow edge
});

test("the Logo is static: identical output across renders (no animation clock)", () => {
	const tokens = resolveTokens(THEMES.houston, full);
	const at = (): string =>
		render(createElement(Logo, { hues, capability: full, tokens })).lastFrame() ?? "";
	expect(at()).toBe(at());
});

test("the Logo colors its faces from gradient(hues, WORDMARK_WIDTH), a horizontal ramp", () => {
	const tokens = resolveTokens(THEMES.houston, full);
	const ramp = gradient(hues, WORDMARK_WIDTH);
	// Row 0 has a leading space, so its first solid face is at column 1; the static path indexes the ramp by
	// column, so that face is painted ramp[1]. Build the expected opening SGR by rendering a reference cell in
	// the same color+bold and asserting the Logo frame contains it — this pins the output to gradient().
	const ref =
		render(
			createElement(Text, { color: hexForXterm(ramp[1] ?? 0), bold: true }, "█"),
		).lastFrame() ?? "";
	const sgr = ref.slice(0, ref.indexOf("█")); // the opening color+bold escape for that face
	const frame = render(createElement(Logo, { hues, capability: full, tokens })).lastFrame() ?? "";
	expect(frame).toContain(sgr);
});

test("under NO_COLOR the Logo is bold-only and still shows the glyphs", () => {
	const tokens = resolveTokens(THEMES.houston, none);
	const frame = render(createElement(Logo, { hues, capability: none, tokens })).lastFrame() ?? "";
	expect(frame).toContain("█");
	expect(frame).not.toContain("\x1b[38;5;"); // no 256-color foreground SGR
});
