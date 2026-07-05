import { expect, test } from "bun:test";

import { jaccard, tokenSet } from "./jaccard";

test("tokenSet lowercases, splits on non-word, drops empties", () => {
	expect([...tokenSet("Grab, a Coffee!")]).toEqual(["grab", "a", "coffee"]);
	expect(tokenSet("  ").size).toBe(0);
	expect(tokenSet("!!!").size).toBe(0);
});

test("jaccard scores token-set overlap", () => {
	expect(jaccard("grab a coffee", "grab a coffee")).toBe(1);
	expect(jaccard("grab a coffee", "go get coffee now")).toBeLessThan(0.8);
	// A 4-of-5-token overlap clears the JACCARD_DUP=0.80 near-duplicate gate.
	expect(
		jaccard("alpha beta gamma delta", "alpha beta gamma delta epsilon"),
	).toBeGreaterThanOrEqual(0.8);
	// |{the,slow,build} ∩ {the,build,is,slow}| / |union| = 3/4 = 0.75 (below the gate).
	expect(jaccard("the slow build", "the build is slow")).toBeCloseTo(0.75, 5);
});

test("two empty token sets score 0", () => {
	expect(jaccard("", "")).toBe(0);
	expect(jaccard("!!!", "  ")).toBe(0);
});
