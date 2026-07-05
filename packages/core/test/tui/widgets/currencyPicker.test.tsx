import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { detectCapability, glyphSet, resolveTokens } from "../../../src/tui/theme";
import { type CurrencyPickerProps, CurrencyPicker } from "../../../src/tui/widgets";

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

function base(over: Partial<CurrencyPickerProps> = {}): CurrencyPickerProps {
	return {
		query: "in",
		codes: ["INR", "PKR"],
		cursor: 0,
		columns: 100,
		termRows: 24,
		tokens,
		glyphs,
		...over,
	};
}

test("the Currency popup is titled and shows the query with a caret", () => {
	const frame = render(createElement(CurrencyPicker, base())).lastFrame() ?? "";
	expect(frame).toContain("Currency");
	expect(frame).toContain("in█");
});

test("the Currency popup marks the cursor row and lists the filtered codes", () => {
	const frame = render(createElement(CurrencyPicker, base({ cursor: 1 }))).lastFrame() ?? "";
	const line = frame.split("\n").find((l) => l.includes("PKR")) ?? "";
	expect(line).toContain(glyphs.marker);
	expect(frame).toContain("INR");
});

test("the Currency popup shows a no-matches line when codes is empty", () => {
	const frame = render(createElement(CurrencyPicker, base({ codes: [] }))).lastFrame() ?? "";
	expect(frame.toLowerCase()).toContain("no matches");
});

test("the Currency popup footer advertises close and select", () => {
	const frame = render(createElement(CurrencyPicker, base())).lastFrame() ?? "";
	expect(frame).toContain("esc close");
	expect(frame).toContain("↵ select");
});
