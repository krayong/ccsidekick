import { expect, test } from "bun:test";

import { LEAF_PATHS, expectedCount } from "./poolShape";

test("expectedCount is per-cell by pool", () => {
	expect(expectedCount("mood.idle.stranger")).toBe(10);
	expect(expectedCount("mood.busy.legend")).toBe(5);
	expect(expectedCount("greeting.morning.friend")).toBe(3);
	expect(expectedCount("firstContact.partner")).toBe(3);
	expect(expectedCount("egg.partner")).toBe(5);
	expect(expectedCount("event.test_fail")).toBe(3);
	expect(expectedCount("stack.rust.slow")).toBe(3);
	expect(expectedCount("pressure.compact_hint")).toBe(3);
	expect(expectedCount("dateEgg")).toBe(10);
	expect(expectedCount("bogus.path")).toBe(0);
});

test("LEAF_PATHS enumerates every counted cell and sums to 620", () => {
	expect(LEAF_PATHS.length).toBe(176);
	const total = LEAF_PATHS.reduce((n, p) => n + expectedCount(p), 0);
	expect(total).toBe(620);
	expect(new Set(LEAF_PATHS).size).toBe(LEAF_PATHS.length); // no dup paths
	expect(LEAF_PATHS).not.toContain("spinnerVerbs");
	expect(LEAF_PATHS).toContain("dateEgg");
});
