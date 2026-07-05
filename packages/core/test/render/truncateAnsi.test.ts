import { expect, test } from "bun:test";

import { displayWidth, truncateAnsi } from "../../src/render";

test("a string already within width is returned unchanged", () => {
	expect(truncateAnsi("abcdef", 10)).toBe("abcdef");
});

test("truncates plain text to the exact display width", () => {
	const out = truncateAnsi("abcdefgh", 4);
	expect(out).toBe("abcd");
	expect(displayWidth(out)).toBe(4);
});

test("never splits a wide glyph in half", () => {
	// 🌿 is display-width 2; a budget of 3 can only fit "a" + "🌿" (width 3), not "a🌿" plus another cell.
	const out = truncateAnsi("a🌿b", 3);
	expect(displayWidth(out)).toBeLessThanOrEqual(3);
	expect(out.includes("🌿") || out === "a").toBe(true);
});

test("keeps escape sequences intact and closes an open color span when it cuts mid-span", () => {
	const colored = "\x1b[38;5;42mhello\x1b[0m world";
	const out = truncateAnsi(colored, 3);
	expect(out.startsWith("\x1b[38;5;42m")).toBe(true);
	expect(out).toContain("hel");
	expect(out.endsWith("\x1b[0m")).toBe(true);
	expect(displayWidth(out)).toBe(3);
});

test("a fully-colored string that fits is returned unchanged, reset code included", () => {
	const colored = "\x1b[38;5;42mhi\x1b[0m";
	expect(truncateAnsi(colored, 10)).toBe(colored);
});

test("width 0 truncates to an empty string", () => {
	expect(truncateAnsi("hello", 0)).toBe("");
});
