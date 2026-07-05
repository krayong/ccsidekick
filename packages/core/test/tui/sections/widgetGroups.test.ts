import { expect, test } from "bun:test";

import { WIDGET_GROUPS, WIDGET_DESCRIPTIONS, WIDGET_IDS } from "../../../src/tui/sections";

// WIDGET_IDS is DEFAULT_CONFIG.line.widgets' keys, already typed as readonly WidgetId[].
const ALL_IDS = WIDGET_IDS;

test("every widget id belongs to exactly one group, and all 33 are covered", () => {
	const grouped = WIDGET_GROUPS.flatMap((g) => g.widgets);
	expect(new Set(grouped).size).toBe(grouped.length); // no duplicates
	expect(new Set(grouped)).toEqual(new Set(ALL_IDS)); // exact cover
	expect(grouped.length).toBe(33);
});

test("the group names are Format plus the six rail groups", () => {
	expect(WIDGET_GROUPS.map((g) => g.name)).toEqual([
		"Format",
		"Git",
		"Model",
		"Context",
		"Cost",
		"Usage",
		"Session",
	]);
});

test("every widget has a one-line description", () => {
	for (const id of ALL_IDS) expect(WIDGET_DESCRIPTIONS[id]).toBeTruthy();
});
