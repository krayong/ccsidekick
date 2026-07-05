import { expect, test } from "bun:test";

import { detectReducedMotion } from "../../../src/tui/theme";

test("NO_COLOR forces reduced motion", () => {
	expect(detectReducedMotion({ NO_COLOR: "1" })).toBe(true);
	expect(detectReducedMotion({ NO_COLOR: "" })).toBe(true); // presence wins, like detectCapability
});

test("the explicit opt-out forces reduced motion", () => {
	expect(detectReducedMotion({ CCSIDEKICK_REDUCE_MOTION: "1" })).toBe(true);
	expect(detectReducedMotion({ CCSIDEKICK_REDUCE_MOTION: "" })).toBe(true);
});

test("motion is on by default", () => {
	expect(detectReducedMotion({})).toBe(false);
	expect(detectReducedMotion({ TERM: "xterm-256color" })).toBe(false);
});
