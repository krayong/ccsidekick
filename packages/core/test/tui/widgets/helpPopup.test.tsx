import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { KEYMAP } from "../../../src/tui/nav";
import { resolveTokens } from "../../../src/tui/theme";
import { HelpPopup } from "../../../src/tui/widgets";

const tokens = resolveTokens(THEMES.houston, "full");
const frameOf = (): string =>
	render(createElement(HelpPopup, { columns: 100, rows: 24, tokens })).lastFrame() ?? "";

test("Help lists every KEYMAP binding's keys and label (cannot drift)", () => {
	const frame = frameOf();
	for (const b of KEYMAP) {
		expect(frame).toContain(b.keys);
		expect(frame).toContain(b.label);
	}
});

test("Help groups bindings under the three KEYMAP groups", () => {
	const frame = frameOf();
	for (const group of ["Navigate", "Find & preview", "Actions"]) {
		expect(frame).toContain(group);
	}
});

test("Help is a titled popup with an esc-close footer", () => {
	const frame = frameOf();
	expect(frame).toContain("Help");
	expect(frame.toLowerCase()).toContain("esc");
	expect(frame).toContain("╭");
});
