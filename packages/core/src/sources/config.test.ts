import { expect, test } from "bun:test";

import { loadConfig } from "./config";

test("default config resolves theme.name = character (Match Character) and no per-surface overrides", () => {
	const c0 = loadConfig("schema_version = 2\n", 'schema_version = "oops"\n');
	expect(c0.schema_version).toBe(2); // wrong-typed project value falls back to the global, not the default

	const c = loadConfig("", "");
	expect(c.theme.name).toBe("character");
	expect(c.theme.statusline).toBeUndefined();
	expect(c.theme.mood_shift).toBe(false);
	expect(c.theme.banding).toBe("solid");
});

test("[theme].banding parses cycle; an invalid value falls back to solid", () => {
	expect(loadConfig('[theme]\nbanding = "cycle"\n', "").theme.banding).toBe("cycle");
	expect(loadConfig('[theme]\nbanding = "rainbow"\n', "").theme.banding).toBe("solid");
});

test("[theme] parses name + per-surface overrides", () => {
	const c = loadConfig(
		'[theme]\nname = "dracula"\nstatusline = "nord"\ncomment = "batman"\nmood_shift = false\n',
		"",
	);
	expect(c.theme.name).toBe("dracula");
	expect(c.theme.statusline).toBe("nord");
	expect(c.theme.comment).toBe("batman");
	expect(c.theme.mood_shift).toBe(false);
});

test("legacy [theme].mode / [theme].separator keys are ignored without error", () => {
	const c = loadConfig('[theme]\nmode = "character"\nseparator = "slash"\n', "");
	expect(c.theme.name).toBe("character");
	expect("mode" in c.theme).toBe(false);
	expect("separator" in c.theme).toBe(false);
});

test("[theme.icons] still overrides glyphs", () => {
	const c = loadConfig('[theme.icons]\ngit_branch = "↳"\n', "");
	expect(c.theme.icons["git_branch"]).toBe("↳");
});

test("statusline.budget parses when present and is absent otherwise", () => {
	expect(loadConfig("[statusline]\nbudget = 60\n").statusline.budget).toBe(60);
	expect(loadConfig("").statusline.budget).toBeUndefined();
	// a non-number is ignored (stays absent)
	expect(loadConfig('[statusline]\nbudget = "nope"\n').statusline.budget).toBeUndefined();
});

test("[comments] parses character/helpful/min_severity; defaults are on/on/medium", () => {
	const d = loadConfig("");
	expect(d.comments.character).toBe(true);
	expect(d.comments.helpful).toBe(true);
	expect(d.comments.min_severity).toBe("medium");
	const c = loadConfig('[comments]\ncharacter = false\nhelpful = false\nmin_severity = "high"\n');
	expect(c.comments.character).toBe(false);
	expect(c.comments.helpful).toBe(false);
	expect(c.comments.min_severity).toBe("high");
});
