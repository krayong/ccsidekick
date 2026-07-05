import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { type FieldRowProps, type FieldSpec, FieldRow } from "../../../src/tui/widgets";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const toggle: FieldSpec = { id: "e", label: "Enabled", kind: "toggle", value: "on" };
const cyc: FieldSpec = { id: "s", label: "Min severity", kind: "cycle", value: "low" };
const text: FieldSpec = { id: "c", label: "Currency", kind: "text", value: "INR", raw: "INR" };

const base = (over: Partial<FieldRowProps>): FieldRowProps => ({
	field: toggle,
	active: false,
	editing: false,
	buffer: "",
	tokens: resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" })),
	glyphs: glyphSet(false),
	...over,
});

test("an inactive row shows the label and value without a marker", () => {
	const frame = render(createElement(FieldRow, base({}))).lastFrame() ?? "";
	expect(frame).toContain("Enabled");
	expect(frame).toContain("on");
	expect(frame).not.toContain("❯");
});

test("an active row carries the marker", () => {
	const frame = render(createElement(FieldRow, base({ active: true }))).lastFrame() ?? "";
	expect(frame).toContain("❯");
	expect(frame).toContain("Enabled");
});

test("an active cycle field shows its value without cycle arrows", () => {
	const frame =
		render(createElement(FieldRow, base({ field: cyc, active: true }))).lastFrame() ?? "";
	expect(frame).not.toContain("‹");
	expect(frame).not.toContain("›");
	expect(frame).toContain("low"); // the cyc fixture's value
});

test("an editing field shows the buffer and a caret, not the stored value", () => {
	const frame =
		render(
			createElement(
				FieldRow,
				base({ field: text, active: true, editing: true, buffer: "US" }),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("US");
	expect(frame).toContain("█"); // the caret
});
