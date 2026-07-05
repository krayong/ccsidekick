import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { DEFAULT_CONFIG } from "../../../src/sources";
import { FormSection, statuslineFields, type FormSectionProps } from "../../../src/tui/sections";
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

const base = (over: Partial<FormSectionProps>): FormSectionProps => ({
	fields: statuslineFields(DEFAULT_CONFIG),
	cursor: 0,
	editing: false,
	buffer: "",
	rows: 6,
	tokens: resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" })),
	glyphs: glyphSet(false),
	...over,
});

test("windows a long field list and shows a 'more below' affordance", () => {
	const frame =
		render(createElement(FormSection, base({ cursor: 0, rows: 6 }))).lastFrame() ?? "";
	expect(frame).toContain("Currency");
	expect(frame).toContain("more"); // 35 fields, 6 rows → hidden rows below
	expect(frame).not.toContain("todo"); // last widget is off-window at cursor 0
});

test("the marker sits on the cursor field", () => {
	const frame = render(createElement(FormSection, base({ cursor: 1 }))).lastFrame() ?? "";
	expect(frame).toContain("❯ Budget (USD/mo)");
});
