import { expect, test } from "bun:test";

import { loadConfig } from "../../../src/sources";
import { buildFindIndex, rankFind } from "../../../src/tui/shell";

const noop = (): void => {};
const deps = {
	config: loadConfig(""),
	goToSection: () => noop,
	focusField: () => noop,
	runInstall: noop,
	toggleWidget: () => noop,
	openCurrencyPicker: noop,
	beginBudgetEdit: noop,
};

test("the index spans sections, fields, and actions", () => {
	const kinds = new Set(buildFindIndex(deps).map((e) => e.kind));
	expect(kinds.has("section")).toBe(true);
	expect(kinds.has("field")).toBe(true);
	expect(kinds.has("action")).toBe(true);
});

test("every section is jumpable by name", () => {
	const labels = buildFindIndex(deps).map((e) => e.label);
	for (const s of ["Character", "Theme", "Statusline", "Statistics", "Save"]) {
		expect(labels.some((l) => l.includes(s))).toBe(true);
	}
});

test("field entries only come from the form sections (where the cursor is authoritative)", () => {
	const fields = buildFindIndex(deps).filter((e) => e.kind === "field");
	// Voice/Tips/Network are the FormSection-backed sections; Statusline moved onto the widget rail, so its
	// 33 toggles are indexed as actions (below) instead. Every field label is prefixed by one of these three.
	for (const f of fields) {
		expect(["Voice", "Tips", "Network"].some((s) => f.label.startsWith(s))).toBe(true);
	}
});

test("Statusline Currency and Budget are bespoke action entries, not fields", () => {
	const entries = buildFindIndex(deps);
	const currency = entries.find((e) => e.label === "Statusline › Currency");
	const budget = entries.find((e) => e.label === "Statusline › Budget");
	expect(currency?.kind).toBe("action");
	expect(budget?.kind).toBe("action");
});

test("rankFind orders by fuzzy score, best first", () => {
	const ranked = rankFind("theme", buildFindIndex(deps));
	expect(ranked[0]?.label.toLowerCase()).toContain("theme");
});
