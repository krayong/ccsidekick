import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";
import { TabBar } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const full = resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" }));
const mono = resolveTokens(THEMES.houston, detectCapability({ NO_COLOR: "1" }));

test("every tab label renders", () => {
	const frame =
		render(
			createElement(TabBar, { tabs: ["Roster", "Catalog"], active: 0, tokens: full }),
		).lastFrame() ?? "";
	expect(frame).toContain("Roster");
	expect(frame).toContain("Catalog");
});

test("the labels render with the second tab active", () => {
	const frame =
		render(
			createElement(TabBar, { tabs: ["Roster", "Catalog"], active: 1, tokens: full }),
		).lastFrame() ?? "";
	expect(frame).toContain("Roster");
	expect(frame).toContain("Catalog");
});

test("the labels survive NO_COLOR", () => {
	const frame =
		render(
			createElement(TabBar, { tabs: ["Roster", "Catalog"], active: 0, tokens: mono }),
		).lastFrame() ?? "";
	expect(frame).toContain("Roster");
	expect(frame).toContain("Catalog");
});

test("the active tab is accent-colored with no inverse-video, matching SidebarItem/Rail's convention", () => {
	const frame =
		render(
			createElement(TabBar, { tabs: ["Roster", "Catalog"], active: 0, tokens: full }),
		).lastFrame() ?? "";
	expect(frame).not.toContain("\x1b[7m"); // no inverse SGR anywhere in the strip
	const accentColor = full.accent.color;
	expect(accentColor).toBeDefined();
	expect(frame).toContain(`\x1b[38;2;${hexToRgbAnsi(accentColor ?? "")}`); // active tab carries the accent color
	expect(frame).toContain("\x1b[2m"); // inactive tab is dim/muted
});

function hexToRgbAnsi(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `${r};${g};${b}`;
}
