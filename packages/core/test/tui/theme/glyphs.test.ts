import { expect, test } from "bun:test";

import { glyphSet } from "../../../src/tui/theme";

test("Unicode set is the default; ASCII set swaps in plain markers", () => {
	expect(glyphSet(false).marker).toBe("❯");
	expect(glyphSet(true).marker).toBe(">");
	expect(glyphSet(true).vRule).toBe("|");
});

test("the selection marker and its blank are the same single column wide", () => {
	for (const ascii of [true, false]) {
		const g = glyphSet(ascii);
		expect([...g.marker]).toHaveLength(1);
		expect([...g.markerBlank]).toHaveLength(1);
	}
});
