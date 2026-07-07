import { expect, test } from "bun:test";

import { applyRailKey, type RailState } from "../../../src/tui/widgets";

const key = (input: string, over: Record<string, boolean> = {}) => ({ input, key: over as never });
const S0: RailState = { focus: 0, catCursor: 0, itemCursor: 0 };

test("d/right walks focus category -> list (the deepest focusable column); a/left exits at the first column", () => {
	const toList = applyRailKey(S0, key("d"), 2, 5);
	expect(toList.state.focus).toBe(1);
	// Right at the list does not move focus into the passive detail column — it stays put.
	const stay = applyRailKey(toList.state, key("", { rightArrow: true }), 2, 5);
	expect(stay.state.focus).toBe(1);
	const back = applyRailKey({ focus: 0, catCursor: 0, itemCursor: 0 }, key("a"), 2, 5);
	expect(back.exit).toBe(true); // a/left at the category column returns to the sidebar
});

test("w/s move the cursor of the focused column only", () => {
	expect(
		applyRailKey({ focus: 0, catCursor: 0, itemCursor: 0 }, key("s"), 2, 5).state.catCursor,
	).toBe(1);
	expect(
		applyRailKey({ focus: 1, catCursor: 0, itemCursor: 2 }, key("w"), 2, 5).state.itemCursor,
	).toBe(1);
	// category cursor does not move while the list column is focused:
	expect(
		applyRailKey({ focus: 1, catCursor: 0, itemCursor: 2 }, key("s"), 2, 5).state.catCursor,
	).toBe(0);
});

test("changing the category resets the item cursor so a shorter list can't be indexed out of range", () => {
	// Themes(8) -> Options(2): a deep item cursor must reset, or the detail lookup reads undefined.
	const r = applyRailKey({ focus: 0, catCursor: 0, itemCursor: 5 }, key("s"), 2, 2);
	expect(r.state.catCursor).toBe(1);
	expect(r.state.itemCursor).toBe(0);
});

test("d/right at the list column is a true no-op (never focuses the passive detail column)", () => {
	const list: RailState = { focus: 1, catCursor: 0, itemCursor: 0 };
	const r = applyRailKey(list, key("d"), 2, 5);
	expect(r.state).toBe(list); // same object, not just equal, so no redundant re-render
	expect(r.exit).toBe(false);
	expect(r.act).toBe(false);
});

test("enter on the category column drills into the list; enter on the list acts", () => {
	// Enter at focus 0 moves focus to the list (no act); Enter at focus 1 signals act.
	const drill = applyRailKey(
		{ focus: 0, catCursor: 0, itemCursor: 0 },
		key("", { return: true }),
		2,
		5,
	);
	expect(drill.state.focus).toBe(1);
	expect(drill.act).toBe(false);
	const act = applyRailKey(
		{ focus: 1, catCursor: 0, itemCursor: 0 },
		key("", { return: true }),
		2,
		5,
	);
	expect(act.act).toBe(true);
});
