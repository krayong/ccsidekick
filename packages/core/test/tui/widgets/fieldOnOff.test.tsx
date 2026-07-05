import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { FieldRow, type FieldSpec } from "../../../src/tui/widgets";

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

const toggle = (value: "on" | "off"): FieldSpec => ({
	id: "t",
	label: "Comments",
	kind: "toggle",
	value,
	toggle: (c) => c,
});

test("a toggle field on renders ● on", () => {
	const frame =
		render(
			createElement(FieldRow, {
				field: toggle("on"),
				active: false,
				editing: false,
				buffer: "",
				tokens,
				glyphs,
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("● on");
});

test("a toggle field off renders ○ off", () => {
	const frame =
		render(
			createElement(FieldRow, {
				field: toggle("off"),
				active: false,
				editing: false,
				buffer: "",
				tokens,
				glyphs,
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("○ off");
});
