import { expect, test } from "bun:test";

import { THEMES, type ThemeData } from "../data";
import { type Config, DEFAULT_CONFIG } from "../sources";

import {
	resolveTheme,
	accentColor,
	valueColor,
	signalColor,
	iconFor,
	applyMood,
	helpfulStyle,
} from "./theme";

const noPack = (): ThemeData | null => null;
const withTheme = (theme: Partial<Config["theme"]>): Config => ({
	...DEFAULT_CONFIG,
	theme: { ...DEFAULT_CONFIG.theme, ...theme },
});

test("default config resolves every surface to houston", () => {
	const t = resolveTheme(DEFAULT_CONFIG, noPack);
	expect(t.statusline.hues).toEqual(THEMES.houston.hues);
	expect(t.logo.hues).toEqual(THEMES.houston.hues);
	expect(t.comment.gradient).toEqual(THEMES.houston.comment);
});

test("a per-surface override resolves independently of the default name", () => {
	const t = resolveTheme(
		withTheme({ name: "houston", statusline: "dracula", logo: "nord" }),
		noPack,
	);
	expect(t.statusline.hues).toEqual(THEMES.dracula.hues);
	expect(t.logo.hues).toEqual(THEMES.nord.hues);
	expect(t.comment.gradient).toEqual(THEMES.houston.comment); // falls back to name
});

test("an empty-string override falls back to the default name", () => {
	const t = resolveTheme(withTheme({ name: "dracula", statusline: "" }), noPack);
	expect(t.statusline.hues).toEqual(THEMES.dracula.hues);
});

test("an unknown name resolves to houston", () => {
	const t = resolveTheme(withTheme({ name: "no-such-theme" }), noPack);
	expect(t.statusline.hues).toEqual(THEMES.houston.hues);
});

test("a pack name resolves to that pack's theme via lookupPackTheme", () => {
	const packTheme: ThemeData = {
		displayName: "Batman",
		hues: [220, 178, 111, 75],
		comment: [117, 223, 178],
		signals: { nominal: 46, caution: 214, critical: 196 },
		separator: 111,
	};
	const lookup = (n: string): ThemeData | null => (n === "batman" ? packTheme : null);
	const t = resolveTheme(withTheme({ comment: "batman" }), lookup);
	expect(t.comment.gradient).toEqual(packTheme.comment);
});

test("a pack name with no theme resolves to houston", () => {
	const t = resolveTheme(withTheme({ comment: "ghost" }), noPack);
	expect(t.comment.gradient).toEqual(THEMES.houston.comment);
});

test("theme.name character resolves every surface to the persona's pack theme", () => {
	const packTheme: ThemeData = {
		displayName: "Batman",
		hues: [220, 178, 111, 75],
		comment: [117, 223, 178],
		signals: { nominal: 46, caution: 214, critical: 196 },
		separator: 111,
	};
	const lookup = (n: string): ThemeData | null => (n === "batman" ? packTheme : null);
	const t = resolveTheme(withTheme({ name: "character" }), lookup, "batman");
	expect(t.statusline.hues).toEqual(packTheme.hues);
	expect(t.logo.hues).toEqual(packTheme.hues);
	expect(t.comment.gradient).toEqual(packTheme.comment);
});

test("theme.name character falls through to houston when the persona ships no theme", () => {
	const t = resolveTheme(withTheme({ name: "character" }), () => null, "batman");
	expect(t.statusline.hues).toEqual(THEMES.houston.hues);
});

test("a per-surface character override follows the persona while name stays fixed", () => {
	const packTheme: ThemeData = {
		displayName: "Batman",
		hues: [220, 178, 111, 75],
		comment: [117, 223, 178],
		signals: { nominal: 46, caution: 214, critical: 196 },
		separator: 111,
	};
	const lookup = (n: string): ThemeData | null => (n === "batman" ? packTheme : null);
	const t = resolveTheme(withTheme({ name: "houston", logo: "character" }), lookup, "batman");
	expect(t.logo.hues).toEqual(packTheme.hues); // logo follows persona
	expect(t.statusline.hues).toEqual(THEMES.houston.hues); // name stays houston
});

test("line-solid: every cell on a row shares hues[lineIdx mod len]; value matches accent", () => {
	const s = resolveTheme(DEFAULT_CONFIG, noPack).statusline;
	expect(s.banding).toBe("solid");
	expect(accentColor(s, 0)).toBe(s.hues[0]!);
	expect(accentColor(s, 2)).toBe(s.hues[2]!);
	expect(accentColor(s, s.hues.length)).toBe(s.hues[0]!); // wraps
	expect(valueColor(s, 2)).toBe(accentColor(s, 2));
	expect(accentColor(s, 0, 3)).toBe(accentColor(s, 0, 0)); // cellIdx ignored under solid
});

test("cycle banding advances the hue per cell, hues[lineIdx + cellIdx], and wraps", () => {
	const s = resolveTheme(withTheme({ banding: "cycle" }), noPack).statusline;
	const len = s.hues.length;
	// line 0: c0 | c1 | c2 …
	expect(accentColor(s, 0, 0)).toBe(s.hues[0]!);
	expect(accentColor(s, 0, 1)).toBe(s.hues[1]!);
	expect(accentColor(s, 0, 2)).toBe(s.hues[2]!);
	// line 1 starts one stop further along: c1 | c2 …
	expect(accentColor(s, 1, 0)).toBe(s.hues[1]!);
	expect(accentColor(s, 1, 1)).toBe(s.hues[2]!);
	// (lineIdx + cellIdx) wraps the palette
	expect(accentColor(s, 0, len)).toBe(s.hues[0]!);
	expect(valueColor(s, 1, 1)).toBe(accentColor(s, 1, 1));
});

test("signalColor reads the statusline signal block", () => {
	const s = resolveTheme(DEFAULT_CONFIG, noPack).statusline;
	expect(signalColor(s, "critical")).toBe(THEMES.houston.signals.critical);
	expect(signalColor(s, "nominal")).toBe(THEMES.houston.signals.nominal);
});

test("icon precedence: config over default; value-only field is empty", () => {
	const t = resolveTheme(DEFAULT_CONFIG, noPack);
	expect(iconFor("git_branch", t, DEFAULT_CONFIG)).toBe("🌿");
	expect(iconFor("git_branch", t, withTheme({ icons: { git_branch: "→" } }))).toBe("→");
	expect(iconFor("model", t, DEFAULT_CONFIG)).toBe("");
});

test("applyMood: signals and idle/busy inert; happy/struggling/recovery shift", () => {
	const c = 250;
	expect(applyMood(c, "struggling", true)).toBe(c);
	expect(applyMood(c, "idle", false)).toBe(c);
	expect(applyMood(c, "happy", false)).not.toBe(c);
	expect(applyMood(c, "block_limit", false)).toBe(applyMood(c, "struggling", false));
});

test("helpfulStyle is engine-fixed bold bright-white per severity", () => {
	expect(helpfulStyle("critical")).toEqual({ emoji: "🚨", color: 231 });
	expect(helpfulStyle("low")).toEqual({ emoji: "💬", color: 231 });
});
