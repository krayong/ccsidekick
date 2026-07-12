import { expect, test } from "bun:test";

import {
	applySetup,
	listValues,
	parseSetup,
	runList,
	runSetup,
	type SetupDeps,
} from "../../src/cli";
import { type Config, DEFAULT_CONFIG } from "../../src/sources";

const env = {} as NodeJS.ProcessEnv;

test("parseSetup accepts valid flags and resolves the default global target", () => {
	const p = parseSetup(["--character", "batman", "--mode", "fixed"], "/home/dev", env);
	expect(p.errors).toEqual([]);
	expect(p.flags.character).toBe("batman");
	expect(p.flags.mode).toBe("fixed");
	expect(p.target.scope).toBe("global");
	expect(p.target.dir).toBe("/home/dev/.claude");
});

test("parseSetup rejects an unknown character with the valid set", () => {
	const p = parseSetup(["--character", "nope"], "/home/dev", env);
	expect(p.errors.length).toBe(1);
	expect(p.errors[0]).toContain("invalid --character");
	expect(p.errors[0]).toContain("batman");
});

test("parseSetup rejects an unknown theme and an invalid mode/budget/on-off", () => {
	expect(parseSetup(["--theme", "no-theme"], "/h", env).errors[0]).toContain("invalid --theme");
	expect(parseSetup(["--mode", "sideways"], "/h", env).errors[0]).toContain("invalid --mode");
	expect(parseSetup(["--budget", "-3"], "/h", env).errors[0]).toContain("invalid --budget");
	expect(parseSetup(["--comments", "yes"], "/h", env).errors[0]).toContain("invalid --comments");
});

test("parseSetup honors --config-dir over the env and the home default", () => {
	expect(parseSetup(["--config-dir", "/x"], "/h", env).target.dir).toBe("/x");
	expect(parseSetup([], "/h", { CLAUDE_CONFIG_DIR: "/env" }).target.dir).toBe("/env");
});

test("parseSetup flags --global and --local together as an error", () => {
	const p = parseSetup(["--global", "--local"], "/h", env);
	expect(p.errors[0]).toContain("only one of --global / --local");
});

test("applySetup patches only the passed flags", () => {
	const out = applySetup(DEFAULT_CONFIG, { theme: "dracula", comments: false });
	expect(out.theme.name).toBe("dracula");
	expect(out.comments.character).toBe(false);
	// untouched
	expect(out.character.mode).toBe(DEFAULT_CONFIG.character.mode);
	expect(out.character.name).toBe(DEFAULT_CONFIG.character.name);
	expect(out.comments.helpful).toBe(DEFAULT_CONFIG.comments.helpful);
});

test("applySetup --character implies fixed mode unless --mode is given", () => {
	// Random mode ignores the named character, so a bare --character would be a no-op without this.
	expect(applySetup(DEFAULT_CONFIG, { character: "spiderman" }).character.mode).toBe("fixed");
	expect(
		applySetup(DEFAULT_CONFIG, { character: "spiderman", mode: "random" }).character.mode,
	).toBe("random");
});

test("applySetup --widgets turns the listed widgets on and every other off", () => {
	const out = applySetup(DEFAULT_CONFIG, { widgets: ["dir", "model"] });
	expect(out.statusline.widgets.dir).toBe(true);
	expect(out.statusline.widgets.model).toBe(true);
	expect(out.statusline.widgets.git_branch).toBe(false); // not listed -> off
});

test("parseSetup accepts --usage-fetch on/off and rejects other values", () => {
	expect(parseSetup(["--usage-fetch", "on"], "/h", env).flags.usageFetch).toBe(true);
	expect(parseSetup(["--usage-fetch", "off"], "/h", env).flags.usageFetch).toBe(false);
	expect(parseSetup(["--usage-fetch", "yes"], "/h", env).errors[0]).toContain(
		"invalid --usage-fetch",
	);
});

test("applySetup --usage-fetch toggles only network.usage_fetch", () => {
	const out = applySetup(DEFAULT_CONFIG, { usageFetch: true });
	expect(out.network.usage_fetch).toBe(true);
	// other network fields untouched
	expect(out.network.fx_refresh).toBe(DEFAULT_CONFIG.network.fx_refresh);
	expect(out.network.balance_path).toBe(DEFAULT_CONFIG.network.balance_path);
});

test("runSetup writes the patched config through the injected save and prints a summary", () => {
	let saved: Config | null = null;
	let savedScope = "";
	const out: string[] = [];
	const deps: SetupDeps = {
		save: (config, scope) => {
			saved = config;
			savedScope = scope;
		},
		renderBin: "ccsidekick-render",
		readConfig: () => null, // fresh install -> defaults
		cwd: "/proj",
		homeDir: "/home/dev",
		env,
		out: (s) => out.push(s),
		err: () => {},
	};
	const code = runSetup(["--character", "deadpool", "--theme", "dracula"], deps);
	expect(code).toBe(0);
	expect(savedScope).toBe("global");
	expect(saved!.character.name).toBe("deadpool");
	expect(saved!.theme.name).toBe("dracula");
	expect(out.join("")).toContain("deadpool");
});

test("runSetup returns 1 and never saves on a validation error", () => {
	let called = false;
	const errs: string[] = [];
	const code = runSetup(["--character", "bogus"], {
		save: () => {
			called = true;
		},
		renderBin: "r",
		readConfig: () => null,
		cwd: "/proj",
		homeDir: "/home/dev",
		env,
		out: () => {},
		err: (s) => errs.push(s),
	});
	expect(code).toBe(1);
	expect(called).toBe(false);
	expect(errs.join("")).toContain("invalid --character");
});

test("runSetup patches onto the existing config, not the defaults", () => {
	let saved: Config | null = null;
	const existing = {
		...DEFAULT_CONFIG,
		character: { ...DEFAULT_CONFIG.character, name: "barbie" },
	};
	const code = runSetup(["--mode", "fixed"], {
		save: (c) => {
			saved = c;
		},
		renderBin: "r",
		readConfig: () => toToml(existing),
		cwd: "/proj",
		homeDir: "/home/dev",
		env,
		out: () => {},
		err: () => {},
	});
	expect(code).toBe(0);
	expect(saved!.character.name).toBe("barbie"); // preserved from existing
	expect(saved!.character.mode).toBe("fixed"); // patched
});

test("runList prints valid values and rejects an unknown kind", () => {
	const out: string[] = [];
	expect(
		runList(
			"characters",
			(s) => out.push(s),
			() => {},
		),
	).toBe(0);
	expect(out.join("")).toContain("batman");
	expect(
		runList(
			"bogus",
			() => {},
			() => {},
		),
	).toBe(1);
});

test("listValues covers the three kinds and nothing else", () => {
	expect(listValues("characters")).toContain("batman");
	expect(listValues("themes")).toContain("character");
	expect(listValues("widgets")).toContain("dir");
	expect(listValues("nope")).toBeNull();
});

// A tiny TOML emitter for the existing-config test (avoids importing smol-toml here). Only the fields the test
// reads back need to round-trip; loadConfig fills the rest from defaults.
function toToml(c: Config): string {
	return [`[character]`, `name = "${c.character.name}"`, `mode = "${c.character.mode}"`].join(
		"\n",
	);
}
