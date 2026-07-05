import { expect, test } from "bun:test";

import { displayWidth, padEndDisplay } from "../../src/render";

test("pads a wide-glyph string to the target display width", () => {
	// ⚡ is a single UTF-16 code unit but display-width 2, so "⚡x".length === 2 while its display
	// width is 3. Plain String.padEnd would pad by code unit count and overshoot to width 7; only
	// a display-width-aware pad reaches exactly 6.
	const out = padEndDisplay("⚡x", 6);
	expect(displayWidth(out)).toBe(6);
	expect(out.endsWith("   ")).toBe(true);
});

test("an already-wide string is returned unchanged", () => {
	expect(padEndDisplay("abcdef", 4)).toBe("abcdef");
});
