import { expect, test } from "bun:test";

import { loadConfig } from "./config";

test("default config resolves theme.name = houston and no per-surface overrides", () => {
	const c = loadConfig("", "");
	expect(c.theme.name).toBe("houston");
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
	expect(c.theme.name).toBe("houston");
	expect("mode" in c.theme).toBe(false);
	expect("separator" in c.theme).toBe(false);
});

test("[theme.icons] still overrides glyphs", () => {
	const c = loadConfig('[theme.icons]\ngit_branch = "↳"\n', "");
	expect(c.theme.icons["git_branch"]).toBe("↳");
});

test("line.budget parses when present and is absent otherwise", () => {
	expect(loadConfig("[line]\nbudget = 60\n").line.budget).toBe(60);
	expect(loadConfig("").line.budget).toBeUndefined();
	// a non-number is ignored (stays absent)
	expect(loadConfig('[line]\nbudget = "nope"\n').line.budget).toBeUndefined();
});
