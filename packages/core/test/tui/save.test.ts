import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { type Config, DEFAULT_CONFIG } from "../../src/sources";
import { save, spinnerVerbUnion } from "../../src/tui";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const VERBS: Record<string, readonly string[]> = {
	batman: ["Brooding", "Vowing", "Stalking"],
	robin: ["Quipping", "Vowing", "Tumbling"], // "Vowing" overlaps batman
	alfred: ["Serving", "Sighing"],
};
const resolveVerbs = (name: string): readonly string[] => VERBS[name] ?? [];

const withChar = (over: Partial<Config["character"]>): Config => ({
	...DEFAULT_CONFIG,
	character: { ...DEFAULT_CONFIG.character, ...over },
});

test("FIXED mode contributes only the active character's verbs", () => {
	const config = withChar({ mode: "fixed", name: "batman" });
	expect(spinnerVerbUnion(config, resolveVerbs, ["batman", "robin"])).toEqual([
		"Brooding",
		"Vowing",
		"Stalking",
	]);
});

test("RANDOM mode unions the roster (dedup, order-stable)", () => {
	const config = withChar({ mode: "random", roster: ["batman", "robin"] });
	expect(spinnerVerbUnion(config, resolveVerbs, [])).toEqual([
		"Brooding",
		"Vowing",
		"Stalking",
		"Quipping",
		"Tumbling",
	]);
});

test("RANDOM mode with an empty roster unions every installed pack", () => {
	const config = withChar({ mode: "random", roster: [] });
	expect(spinnerVerbUnion(config, resolveVerbs, ["alfred", "robin"])).toEqual([
		"Serving",
		"Sighing",
		"Quipping",
		"Vowing",
		"Tumbling",
	]);
});

test("a global save writes config.toml and wires settings.json with the verb union", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsidekick-save-")));
	const config = withChar({ mode: "fixed", name: "batman" });
	save(config, "global", dir, "/bin/ccsidekick-render", { resolveVerbs, installed: ["batman"] });

	expect(existsSync(join(dir, "ccsidekick", "config.toml"))).toBe(true);

	const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as {
		statusLine: { command: string };
		spinnerVerbs: { mode: string; verbs: string[] };
		hooks: Record<string, unknown>;
	};
	expect(settings.statusLine.command).toBe("/bin/ccsidekick-render render");
	expect(settings.spinnerVerbs.verbs).toEqual(["Brooding", "Vowing", "Stalking"]);
	expect(settings.hooks["PostToolUse"]).toBeDefined();
});

test("a local save writes ./.ccsidekick/config.toml under the injected cwd", () => {
	const cwd = track(mkdtempSync(join(tmpdir(), "ccsidekick-local-")));
	save(DEFAULT_CONFIG, "local", "/unused", "/bin/ccsidekick-render", {
		resolveVerbs,
		installed: ["batman"],
		cwd,
	});
	expect(existsSync(join(cwd, ".ccsidekick", "config.toml"))).toBe(true);
	// Without wireLocalSettings, no settings.json is written.
	expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
});
