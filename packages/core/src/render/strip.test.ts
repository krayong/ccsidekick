import { expect, test } from "bun:test";

import { stripAnsi, displayWidth } from "./strip";

test("strips SGR escapes and measures plain width", () => {
	expect(stripAnsi("\x1b[31mhi\x1b[0m")).toBe("hi");
	expect(displayWidth("\x1b[31mhi\x1b[0m")).toBe(2);
});

test("strips multiple and 256-color SGR escapes", () => {
	expect(stripAnsi("\x1b[38;5;40ma\x1b[0m\x1b[1mb\x1b[0m")).toBe("ab");
	expect(displayWidth("\x1b[38;5;40ma\x1b[0m\x1b[1mb\x1b[0m")).toBe(2);
});

test("severity emoji count as two columns", () => {
	expect(displayWidth("🚨")).toBe(2);
	expect(displayWidth("💡")).toBe(2);
	expect(displayWidth("💬")).toBe(2);
	expect(displayWidth("🚨 x")).toBe(4); // 2 + space + 1
	expect(displayWidth("🦇")).toBe(2); // batman comment emblem
});

test("every pack emblem counts as two columns (so the emblem never collides with the comment)", () => {
	// A pack emblem is followed by a single space before the comment text; if the emblem is measured as
	// one column but renders two-wide, that space is visually swallowed and the text abuts the emblem.
	expect(displayWidth("🦇")).toBe(2); // batman
	expect(displayWidth("⚡")).toBe(2); // harry-potter
	expect(displayWidth("💅")).toBe(2); // barbie
	expect(displayWidth("🎀")).toBe(2); // hello-kitty
	expect(displayWidth("🕷")).toBe(2); // spiderman
});

test("emoji-presentation base + U+FE0F is two columns; text-presentation U+FE0E is one", () => {
	expect(displayWidth("⚠️")).toBe(2); // ⚠ + U+FE0F (severity high)
	expect(displayWidth("⚠︎")).toBe(1); // ⚠ + U+FE0E (git_conflict text glyph)
});

test("provider badge emoji count as two columns", () => {
	expect(displayWidth("🔑")).toBe(2);
	expect(displayWidth("🪨")).toBe(2);
	expect(displayWidth("☁️")).toBe(2); // ☁ + U+FE0F (vertex badge)
});

test("East-Asian Wide / Fullwidth code points count as two columns", () => {
	expect(displayWidth("日本語")).toBe(6); // CJK Unified: 3 × 2
	expect(displayWidth("한글")).toBe(4); // Hangul syllables: 2 × 2
	expect(displayWidth("Ａ")).toBe(2); // fullwidth Latin A (U+FF21)
	expect(displayWidth("、")).toBe(2); // CJK punctuation (ideographic comma U+3001)
	expect(displayWidth("あ")).toBe(2); // wide kana (Hiragana U+3042)
	expect(displayWidth("abc")).toBe(3); // ASCII unchanged
});

test("combining marks are zero-width", () => {
	expect(displayWidth("é")).toBe(1); // e + combining acute accent
});
