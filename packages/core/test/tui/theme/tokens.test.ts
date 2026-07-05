import { expect, test } from "bun:test";

import { THEMES } from "../../../src/data";
import { hexForXterm, nearestAnsi16, resolveTokens } from "../../../src/tui/theme";

const houston = THEMES.houston;

test("hexForXterm maps cube endpoints to #000000 and #ffffff", () => {
	expect(hexForXterm(16)).toBe("#000000");
	expect(hexForXterm(231)).toBe("#ffffff");
	expect(hexForXterm(222)).toMatch(/^#[0-9a-f]{6}$/);
});

test("nearestAnsi16 snaps to a named ANSI color", () => {
	expect(nearestAnsi16(16)).toBe("black");
	expect(["white", "whiteBright"]).toContain(nearestAnsi16(231));
});

test("full tier resolves accent to a bold hex from hues[3]", () => {
	const t = resolveTokens(houston, "full");
	expect(t.accent.bold).toBe(true);
	expect(t.accent.color).toBe(hexForXterm(houston.hues[3] ?? 0));
	expect(t.dataHues).toHaveLength(houston.hues.length);
	expect(t.dataHues[0]).toMatch(/^#[0-9a-f]{6}$/);
});

test("basic tier resolves accent to a named color, not a hex", () => {
	const t = resolveTokens(houston, "basic");
	expect(t.accent.color).toBe(nearestAnsi16(houston.hues[3] ?? 0));
	expect(t.accent.color?.startsWith("#")).toBe(false);
});

test("none tier drops all color and keeps non-color cues", () => {
	const t = resolveTokens(houston, "none");
	expect(t.accent).toEqual({ bold: true });
	expect(t.separator).toEqual({ dimColor: true });
	expect(t.textMuted).toEqual({ dimColor: true });
	expect(t.frame).toEqual({});
	expect(t.dataHues).toEqual([]);
});
