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

test("the wide sidebar numbers each section 1..8", () => {
	const frame =
		render(
			createElement(AppShell, {
				nav: INITIAL_NAV,
				tokens,
				glyphs,
				configDir: "~/.claude",
				scope: "global" as const,
				dirty: true,
				columns: 100,
				rows: 24,
			}),
		).lastFrame() ?? "";
	expect(frame).toMatch(/1 .*Character/);
	expect(frame).toMatch(/8 .*Save/);
});
