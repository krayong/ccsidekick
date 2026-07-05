import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { DEFAULT_CONFIG } from "../../../src/sources";
import {
	type StatuslineSectionProps,
	StatuslineSection,
	WIDGET_DESCRIPTIONS,
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

const formatState = (itemCursor = 0): RailState => ({ focus: 1, catCursor: 0, itemCursor });
const gitState = (itemCursor = 0): RailState => ({ focus: 1, catCursor: 1, itemCursor });
const modelState = (itemCursor = 0): RailState => ({ focus: 1, catCursor: 2, itemCursor });

function base(over: Partial<StatuslineSectionProps> = {}): StatuslineSectionProps {
	return {
		state: formatState(),
		config: DEFAULT_CONFIG,
		editing: false,
		buffer: "",
		rows: 80,
		tokens,
		glyphs,
		...over,
	};
}

test("the category column lists the seven groups", () => {
	const frame = render(createElement(StatuslineSection, base())).lastFrame() ?? "";
	for (const name of ["Format", "Git", "Model", "Context", "Cost", "Usage", "Session"])
		expect(frame).toContain(name);
});

test("the Format group shows Currency and Budget rows with their current values", () => {
	const frame = render(createElement(StatuslineSection, base())).lastFrame() ?? "";
	expect(frame).toContain("Currency");
	expect(frame).toContain(DEFAULT_CONFIG.line.currency); // INR
	expect(frame).toContain("Budget");
});

test("editing the Budget row shows the live buffer plus a caret, not the stored value", () => {
	const frame =
		render(
			createElement(
				StatuslineSection,
				base({ state: formatState(1), editing: true, buffer: "42" }),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("42█");
});

test("when not editing the Budget row shows the stored value, not a caret", () => {
	const frame =
		render(createElement(StatuslineSection, base({ state: formatState(1) }))).lastFrame() ?? "";
	expect(frame).not.toContain("█");
});

test("selecting the Git group lists its widgets", () => {
	const frame =
		render(createElement(StatuslineSection, base({ state: gitState() }))).lastFrame() ?? "";
	expect(frame).toContain("git_branch");
	expect(frame).toContain(glyphs.tabActive); // git_branch defaults on
});

test("the Model group's widgets each show an on/off pill", () => {
	const frame =
		render(createElement(StatuslineSection, base({ state: modelState() }))).lastFrame() ?? "";
	expect(frame).toContain("model");
	expect(frame).toContain(glyphs.tabActive); // model defaults on
	expect(frame).toContain("thinking");
	expect(frame).toContain(glyphs.tabInactive); // thinking defaults off
});

test("the detail shows the highlighted widget's description", () => {
	const frame =
		render(createElement(StatuslineSection, base({ state: gitState(0) }))).lastFrame() ?? "";
	expect(frame).toContain("git_branch");
	expect(frame).toContain(WIDGET_DESCRIPTIONS.git_branch);
});
