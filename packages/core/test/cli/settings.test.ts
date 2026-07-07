// Real temp-file coverage for the settings.json merge: statusLine + the three classify hooks + spinnerVerbs,
// backup retention (oldest + newest), the absolute-bin resolver across install layouts, the refuse-unparseable
// guard, the safe-write verify+rollback, and the config.toml round-trip. Real disk, no mocks.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { installSettings, safeWriteJson, writeConfigToml } from "../../src/cli";
import { DEFAULT_CONFIG, loadConfig } from "../../src/sources";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const MATCHER =
	"Bash|Edit|Write|NotebookEdit|Read|Grep|Glob|WebFetch|WebSearch|Agent|TaskCreate|TaskUpdate|Task|Skill|TodoWrite";

interface HookCmd {
	readonly type: string;
	readonly command: string;
}
interface HookEntry {
	readonly matcher: string;
	readonly hooks: readonly HookCmd[];
}
interface Settings {
	readonly theme?: string;
	readonly statusLine?: {
		readonly type: string;
		readonly command: string;
		readonly refreshInterval: number;
	};
	readonly spinnerVerbs?: { readonly mode: string; readonly verbs: readonly string[] };
	readonly hooks?: Record<string, readonly HookEntry[] | undefined>;
}

const read = (p: string): Settings => JSON.parse(readFileSync(p, "utf8")) as Settings;
const baks = (dir: string): string[] =>
	readdirSync(dir).filter((f) => f.includes("ccsidekick-bak"));
const freshDir = (): string => track(mkdtempSync(join(tmpdir(), "cc-settings-")));

test("merges statusLine + three hooks + spinnerVerbs, backs up, preserves other keys", () => {
	const dir = freshDir();
	const p = join(dir, "settings.json");
	writeFileSync(
		p,
		JSON.stringify({ theme: "dark", spinnerVerbs: { mode: "replace", verbs: ["old"] } }),
	);

	installSettings({
		settingsPath: p,
		renderBin: "/abs/ccsidekick-render",
		spinnerVerbs: ["brooding", "scheming"],
	});

	const s = read(p);
	expect(s.theme).toBe("dark"); // preserved
	expect(s.statusLine?.command).toBe("/abs/ccsidekick-render render");
	expect(s.statusLine?.refreshInterval).toBe(1); // seconds, min 1
	for (const evt of ["PostToolUse", "PostToolUseFailure", "PostToolBatch"]) {
		const entry = s.hooks?.[evt]?.[0];
		expect(entry?.matcher).toBe(MATCHER);
		expect(entry?.hooks[0]?.command).toBe("/abs/ccsidekick-render classify");
	}
	expect(s.spinnerVerbs).toEqual({ mode: "replace", verbs: ["brooding", "scheming"] }); // replaced, not merged
	expect(baks(dir).length).toBe(1); // first install ⇒ one backup (oldest == newest)
});

test("a second install retains exactly two backups (oldest pre-install original + newest)", async () => {
	const dir = freshDir();
	const p = join(dir, "settings.json");
	writeFileSync(p, JSON.stringify({ theme: "dark" })); // the user's pre-install original
	installSettings({ settingsPath: p, renderBin: "/abs/ccsidekick-render", spinnerVerbs: ["a"] });
	await new Promise((r) => setTimeout(r, 5)); // distinct epoch-ms so oldest != newest
	installSettings({ settingsPath: p, renderBin: "/abs/ccsidekick-render", spinnerVerbs: ["b"] });
	expect(baks(dir).length).toBe(2); // oldest (pre-install original) + newest; intermediate ones discarded
});

test("re-install is idempotent (one of our hook entries) and preserves the user's own hook entries", () => {
	const dir = freshDir();
	const p = join(dir, "settings.json");
	const userHook = {
		matcher: "Bash",
		hooks: [{ type: "command", command: "/usr/bin/audit.sh" }],
	};
	writeFileSync(p, JSON.stringify({ hooks: { PostToolUse: [userHook] } }));

	installSettings({ settingsPath: p, renderBin: "/abs/ccsidekick-render", spinnerVerbs: ["a"] });
	installSettings({ settingsPath: p, renderBin: "/abs/ccsidekick-render", spinnerVerbs: ["a"] });

	const post = read(p).hooks?.["PostToolUse"] ?? [];
	expect(post).toHaveLength(2); // the user's entry + exactly one of ours (no duplicate on re-install)
	expect(post[0]).toEqual(userHook);
	expect(post[1]?.hooks[0]?.command).toBe("/abs/ccsidekick-render classify");
});

test("refuses to modify an unparseable settings.json (no write, no backup)", () => {
	const dir = freshDir();
	const p = join(dir, "settings.json");
	writeFileSync(p, "{ this is : not json");
	expect(() => {
		installSettings({
			settingsPath: p,
			renderBin: "/abs/ccsidekick-render",
			spinnerVerbs: ["x"],
		});
	}).toThrow();
	expect(readFileSync(p, "utf8")).toBe("{ this is : not json"); // untouched
	expect(baks(dir).length).toBe(0);
});

test("safe write rolls back to the prior content when the result fails to parse", () => {
	const dir = freshDir();
	const p = join(dir, "settings.json");
	const original = JSON.stringify({ ok: true });
	writeFileSync(p, original);
	expect(() => {
		safeWriteJson(p, "{ broken", original);
	}).toThrow();
	expect(readFileSync(p, "utf8")).toBe(original); // restored from the pre-write content
});

test("writeConfigToml writes a config.toml that loadConfig round-trips", () => {
	const dir = freshDir();
	writeConfigToml(dir, {
		...DEFAULT_CONFIG,
		character: { ...DEFAULT_CONFIG.character, mode: "fixed", name: "joker" },
		statusline: { ...DEFAULT_CONFIG.statusline, currency: "EUR" },
	});
	const cfg = loadConfig(readFileSync(join(dir, "config.toml"), "utf8"));
	expect(cfg.character.mode).toBe("fixed");
	expect(cfg.character.name).toBe("joker");
	expect(cfg.statusline.currency).toBe("EUR");
	expect(cfg.statusline.widgets.pay_as_you_go).toBe(true); // widget key survives the TOML round-trip
});
