import { afterEach, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { INITIAL_NAV } from "../../../src/tui/nav";
import { type AppShellProps, AppShell, POPUP_CHROME_ROWS } from "../../../src/tui/shell";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { Popup } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const base = (over: Partial<AppShellProps> = {}): AppShellProps => ({
	nav: INITIAL_NAV,
	tokens: resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" })),
	glyphs: glyphSet(false),
	configDir: "/home/dev/.claude",
	scope: "global",
	dirty: false,
	columns: 100,
	rows: 24,
	...over,
});

test("the shell shows the brand, every section, the config dir, scope, and hints", () => {
	const { lastFrame } = render(createElement(AppShell, base()));
	const frame = lastFrame() ?? "";
	expect(frame).toContain("ccsidekick");
	for (const name of [
		"Character",
		"Theme",
		"Comments",
		"Network",
		"Statusline",
		"Statistics",
		"Save",
	]) {
		expect(frame).toContain(name);
	}
	expect(frame).toContain("/home/dev/.claude");
	expect(frame).toContain("global");
	expect(frame).toContain("move"); // a sidebar hint label
});

test("a mixed scope shows the [mixed] chip", () => {
	const frame = render(createElement(AppShell, base({ scope: "mixed" }))).lastFrame() ?? "";
	expect(frame).toContain("[mixed]");
});

test("the dirty flag shows an unsaved marker; a clean draft does not", () => {
	expect(render(createElement(AppShell, base({ dirty: true }))).lastFrame() ?? "").toContain(
		"unsaved",
	);
	expect(render(createElement(AppShell, base({ dirty: false }))).lastFrame() ?? "").not.toContain(
		"unsaved",
	);
});

test("the selection marker sits on the active sidebar section only", () => {
	const frame =
		render(
			createElement(AppShell, base({ nav: { ...INITIAL_NAV, section: 0 } })),
		).lastFrame() ?? "";
	expect(frame).toContain(`❯ Character`);
	expect(frame).not.toContain(`❯ Statusline`);
});

test("focusing content moves the marker to the content eyebrow (survives NO_COLOR)", () => {
	const frame =
		render(
			createElement(AppShell, base({ nav: { ...INITIAL_NAV, zone: "content" } })),
		).lastFrame() ?? "";
	expect(frame).toContain("❯ CHARACTER"); // the eyebrow carries the focus marker
	expect(frame).not.toContain("❯ Character"); // the sidebar row drops its marker when unfocused
});

test("a sidebarView narrows the sidebar to the given sections and marks its cursor", () => {
	const frame =
		render(
			createElement(AppShell, base({ sidebarView: { sections: [1], cursor: 0 } })),
		).lastFrame() ?? "";
	expect(frame).toContain("Theme"); // section index 1
	expect(frame).not.toContain("Character");
	expect(frame).not.toContain("Statusline");
});

test("the focused content eyebrow paints at full accent (no fade)", () => {
	// The section heading is painted accent directly (the per-change fade was removed to stop a flicker), so the
	// focused eyebrow carries the accent color on the first frame. Build the accent opening SGR from a reference
	// cell and assert the first frame carries it.
	const tokens = resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" }));
	const ref = render(createElement(Text, { ...tokens.accent }, "X")).lastFrame() ?? "";
	const sgr = ref.slice(0, ref.indexOf("X"));
	const frame =
		render(
			createElement(AppShell, base({ nav: { ...INITIAL_NAV, zone: "content" } })),
		).lastFrame() ?? "";
	expect(frame).toContain(sgr);
});

test("the shell draws a rounded border and clips to its row budget", () => {
	const tall = createElement(
		Box,
		{ flexDirection: "column" },
		...Array.from({ length: 60 }, (_, i) => createElement(Text, { key: i }, `row ${i}`)),
	);
	const frame =
		render(createElement(AppShell, { ...base(), rows: 24, columns: 100 }, tall)).lastFrame() ??
		"";
	expect(frame).toContain("╮"); // round border corner
	expect(frame.split("\n").length).toBeLessThanOrEqual(24);
});

test("a tall popup in the shell keeps its title, footer, and the hint bar visible and never scrolls", () => {
	const tall = createElement(
		Box,
		{ flexDirection: "column" },
		...Array.from({ length: 60 }, (_, i) => createElement(Text, { key: i }, `toml line ${i}`)),
	);
	const overlay = createElement(Popup, {
		title: "Save & install",
		footer: "y ↵ install · esc cancel",
		columns: 100,
		rows: 24 - POPUP_CHROME_ROWS,
		tokens: base().tokens,
		children: tall,
	});
	const frame =
		render(
			createElement(AppShell, { ...base(), rows: 24, columns: 100, overlay }),
		).lastFrame() ?? "";
	expect(frame).toContain("Save & install"); // title survives
	expect(frame).toContain("esc cancel"); // footer survives
	expect(frame).toContain("help"); // a hint-bar label survives (HintBar stays pinned)
	expect(frame.split("\n").length).toBeLessThanOrEqual(24); // no terminal scroll
});
