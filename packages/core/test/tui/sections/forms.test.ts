import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../../../src/sources";
import {
	networkFields,
	sectionFields,
	statuslineFields,
	themeSettingsFields,
	tipsFields,
	voiceFields,
} from "../../../src/tui/sections";

test("statuslineFields leads with currency and budget, then a toggle per widget", () => {
	const f = statuslineFields(DEFAULT_CONFIG);
	expect(f[0]?.id).toBe("currency");
	expect(f[0]?.kind).toBe("text");
	expect(f[1]?.id).toBe("budget");
	expect(f[1]?.kind).toBe("number");
	// 2 leading + 33 widget toggles
	expect(f).toHaveLength(35);
	const dir = f.find((x) => x.id === "widget:dir");
	expect(dir?.kind).toBe("toggle");
	expect(dir?.value).toBe("on"); // dir defaults on
});

test("a widget toggle flips exactly its own key", () => {
	const f = statuslineFields(DEFAULT_CONFIG);
	const dir = f.find((x) => x.id === "widget:dir");
	const next = dir?.toggle?.(DEFAULT_CONFIG);
	expect(next?.line.widgets.dir).toBe(false);
	expect(next?.line.widgets.model).toBe(DEFAULT_CONFIG.line.widgets.model); // untouched
});

test("budget commit parses a number, and an empty string clears it", () => {
	const budget = statuslineFields(DEFAULT_CONFIG).find((x) => x.id === "budget");
	expect(budget?.commit?.(DEFAULT_CONFIG, "60").line.budget).toBe(60);
	expect(budget?.commit?.(DEFAULT_CONFIG, "").line.budget).toBeUndefined();
	expect(budget?.commit?.(DEFAULT_CONFIG, "nope").line.budget).toBeUndefined();
});

test("tips cycles severity and toggles enabled", () => {
	const f = tipsFields(DEFAULT_CONFIG);
	const sev = f.find((x) => x.id === "min_severity");
	expect(sev?.next?.(DEFAULT_CONFIG).helpful.min_severity).toBe("medium");
});

test("theme settings cycle banding and toggle mood_shift", () => {
	const f = themeSettingsFields(DEFAULT_CONFIG);
	const banding = f.find((x) => x.id === "banding");
	expect(banding?.next?.(DEFAULT_CONFIG).theme.banding).toBe("cycle");
});

test("voice and network expose their toggles", () => {
	expect(voiceFields(DEFAULT_CONFIG)[0]?.id).toBe("comments_enabled");
	expect(networkFields(DEFAULT_CONFIG).map((x) => x.id)).toEqual([
		"fx_refresh",
		"usage_fetch",
		"balance_path",
	]);
});

test("sectionFields maps indices to builders and empties the rest", () => {
	expect(sectionFields(1, DEFAULT_CONFIG)[0]?.id).toBe("banding");
	expect(sectionFields(4, DEFAULT_CONFIG)[0]?.id).toBe("fx_refresh");
	expect(sectionFields(5, DEFAULT_CONFIG)[0]?.id).toBe("currency");
	expect(sectionFields(0, DEFAULT_CONFIG)).toEqual([]); // Character uses miller columns, not a form
	expect(sectionFields(6, DEFAULT_CONFIG)).toEqual([]); // Statistics is read-only analytics
});
