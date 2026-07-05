import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { INITIAL_NAV } from "../../../src/tui/nav";
import { AppShell } from "../../../src/tui/shell";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";

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

test("at the narrow tier with content focused, the sidebar collapses to numbered markers", () => {
	const frame =
		render(
			createElement(AppShell, {
				nav: { ...INITIAL_NAV, zone: "content" },
				tokens,
				glyphs,
				configDir: "/home/dev/.claude",
				scope: "global",
				dirty: false,
				columns: 90,
				rows: 24,
				collapsed: true,
			}),
		).lastFrame() ?? "";
	expect(frame).toContain(glyphs.marker); // the active section still carries its marker
	expect(frame).not.toContain("Character"); // full labels are gone once collapsed
});

test("without collapsed, the sidebar keeps its full labels", () => {
	const frame =
		render(
			createElement(AppShell, {
				nav: INITIAL_NAV,
				tokens,
				glyphs,
				configDir: "/home/dev/.claude",
				scope: "global",
				dirty: false,
				columns: 90,
				rows: 24,
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("Character");
});
