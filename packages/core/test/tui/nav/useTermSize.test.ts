import { expect, test } from "bun:test";

import { breakpointFor } from "../../../src/tui/nav";

test("floor wins when width < 80 or height < 24, independently", () => {
	expect(breakpointFor(79, 40)).toBe("floor");
	expect(breakpointFor(200, 23)).toBe("floor");
	expect(breakpointFor(80, 24)).not.toBe("floor");
});

test("breakpointFor tiers at the boundaries", () => {
	expect(breakpointFor(79, 24)).toBe("floor");
	expect(breakpointFor(80, 23)).toBe("floor");
	expect(breakpointFor(80, 24)).toBe("narrow");
	expect(breakpointFor(99, 40)).toBe("narrow");
	expect(breakpointFor(100, 24)).toBe("wide");
	expect(breakpointFor(200, 40)).toBe("wide");
});
