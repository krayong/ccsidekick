import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../../../src/sources";
import {
	commentsFields,
	networkFields,
	sectionFields,
	statuslineFields,
	themeSettingsFields,
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
	expect(next?.statusline.widgets.dir).toBe(false);
	expect(next?.statusline.widgets.model).toBe(DEFAULT_CONFIG.statusline.widgets.model); // untouched
});

test("budget commit parses a number, and an empty string clears it", () => {
	const budget = statuslineFields(DEFAULT_CONFIG).find((x) => x.id === "budget");
	expect(budget?.commit?.(DEFAULT_CONFIG, "60").statusline.budget).toBe(60);
	expect(budget?.commit?.(DEFAULT_CONFIG, "").statusline.budget).toBeUndefined();
	expect(budget?.commit?.(DEFAULT_CONFIG, "nope").statusline.budget).toBeUndefined();
});

test("comments exposes Character + Helpful toggles; Min severity rides under Helpful", () => {
	const f = commentsFields(DEFAULT_CONFIG);
	expect(f.map((x) => x.id)).toEqual(["comments_character", "comments_helpful", "min_severity"]);
	const sev = f.find((x) => x.id === "min_severity");
	expect(sev?.next?.(DEFAULT_CONFIG).comments.min_severity).toBe("high");
});

test("comments hides Min severity when Helpful Comments is off", () => {
	const off = { ...DEFAULT_CONFIG, comments: { ...DEFAULT_CONFIG.comments, helpful: false } };
	expect(commentsFields(off).map((x) => x.id)).toEqual([
		"comments_character",
		"comments_helpful",
	]);
});

test("theme settings cycle banding and toggle mood_shift", () => {
	const f = themeSettingsFields(DEFAULT_CONFIG);
	const banding = f.find((x) => x.id === "banding");
	expect(banding?.next?.(DEFAULT_CONFIG).theme.banding).toBe("cycle");
});

test("network exposes its toggles", () => {
	expect(networkFields(DEFAULT_CONFIG).map((x) => x.id)).toEqual([
		"fx_refresh",
		"usage_fetch",
		"balance_path",
	]);
});

test("sectionFields maps indices to builders and empties the rest", () => {
	expect(sectionFields(1, DEFAULT_CONFIG)[0]?.id).toBe("banding"); // Theme
	expect(sectionFields(2, DEFAULT_CONFIG)[0]?.id).toBe("comments_character"); // Comments
	expect(sectionFields(3, DEFAULT_CONFIG)[0]?.id).toBe("fx_refresh"); // Network
	expect(sectionFields(4, DEFAULT_CONFIG)[0]?.id).toBe("currency"); // Statusline
	expect(sectionFields(0, DEFAULT_CONFIG)).toEqual([]); // Character uses miller columns, not a form
	expect(sectionFields(5, DEFAULT_CONFIG)).toEqual([]); // Statistics is read-only analytics
});
