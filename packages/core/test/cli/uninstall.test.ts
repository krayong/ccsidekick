// Real temp-file coverage for uninstall: strip-keys removes our statusLine/spinnerVerbs/three hooks while
// preserving everything else, leaves a user's own statusLine/spinnerVerbs untouched, always removes our hook
// entries (keeping the user's own), and the opt-in restore brings back the pre-install content. Real disk.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { installSettings, runUninstall } from "../../src/cli";

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
const EVENTS = ["PostToolUse", "PostToolUseFailure", "PostToolBatch"] as const;
const ourHook = {
	matcher: MATCHER,
	hooks: [{ type: "command", command: "/abs/ccsidekick-render classify" }],
};

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
	readonly statusLine?: { readonly type: string; readonly command: string };
	readonly spinnerVerbs?: { readonly mode: string; readonly verbs: readonly string[] };
	readonly hooks?: Record<string, readonly HookEntry[] | undefined>;
}
const read = (p: string): Settings => JSON.parse(readFileSync(p, "utf8")) as Settings;
const freshFile = (): string =>
	join(track(mkdtempSync(join(tmpdir(), "cc-uninstall-"))), "settings.json");

test("strip-keys removes our statusLine, spinnerVerbs, and all three hooks; keeps unrelated keys", () => {
	const p = freshFile();
	writeFileSync(p, JSON.stringify({ theme: "dark" }));
	installSettings({ settingsPath: p, renderBin: "/abs/ccsidekick-render", spinnerVerbs: ["a"] });

	runUninstall({ settingsPath: p });

	const s = read(p);
	expect(s.theme).toBe("dark"); // preserved
	expect(s.statusLine).toBeUndefined();
	expect(s.spinnerVerbs).toBeUndefined();
	for (const evt of EVENTS) expect(s.hooks?.[evt]).toBeUndefined();
});

test("leaves a user-set statusLine/spinnerVerbs intact while still removing our hooks", () => {
	const p = freshFile();
	writeFileSync(
		p,
		JSON.stringify({
			statusLine: { type: "command", command: "/home/me/my-statusline.sh" },
			spinnerVerbs: { mode: "replace", verbs: ["mine"] },
			hooks: {
				PostToolUse: [ourHook],
				PostToolUseFailure: [ourHook],
				PostToolBatch: [ourHook],
			},
		}),
	);

	runUninstall({ settingsPath: p });

	const s = read(p);
	expect(s.statusLine?.command).toBe("/home/me/my-statusline.sh"); // not ours ⇒ untouched
	expect(s.spinnerVerbs).toEqual({ mode: "replace", verbs: ["mine"] }); // user's ⇒ untouched
	for (const evt of EVENTS) expect(s.hooks?.[evt]).toBeUndefined(); // our hooks still stripped
});

test("removes only our hook entry, keeping the user's own under the same event", () => {
	const p = freshFile();
	const userHook = {
		matcher: "Bash",
		hooks: [{ type: "command", command: "/usr/bin/audit.sh" }],
	};
	writeFileSync(p, JSON.stringify({ hooks: { PostToolUse: [userHook, ourHook] } }));

	runUninstall({ settingsPath: p });

	expect(read(p).hooks?.["PostToolUse"]).toEqual([userHook]);
});

test("restoreBackup restores the pre-install content", () => {
	const p = freshFile();
	writeFileSync(p, JSON.stringify({ theme: "dark", custom: 1 }));
	installSettings({ settingsPath: p, renderBin: "/abs/ccsidekick-render", spinnerVerbs: ["a"] });

	runUninstall({ settingsPath: p, restoreBackup: true });

	const s = read(p);
	expect(s.theme).toBe("dark");
	expect(s.statusLine).toBeUndefined();
	expect(s.spinnerVerbs).toBeUndefined();
	expect(s.hooks).toBeUndefined();
});

test("a missing settings.json is a no-op", () => {
	const p = freshFile();
	expect(() => {
		runUninstall({ settingsPath: p });
	}).not.toThrow();
});

test("restoreBackup with no backup on disk changes nothing and does not claim success", () => {
	const p = freshFile();
	writeFileSync(p, JSON.stringify({ theme: "dark" })); // present, but no *.ccsidekick-bak.* beside it
	let out = "";
	runUninstall({ settingsPath: p, restoreBackup: true, out: (t) => (out += t) });
	expect(out).not.toContain("Uninstalled"); // must not falsely report success
	expect(out.toLowerCase()).toContain("no ccsidekick backup");
	expect(read(p).theme).toBe("dark"); // settings left untouched
});

test("runUninstall prints the repository issues link", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsk-uninst-")));
	const settingsPath = join(dir, "settings.json");
	writeFileSync(settingsPath, "{}");
	let out = "";
	runUninstall({ settingsPath, out: (t) => (out += t) });
	expect(out).toContain("https://github.com/krayong/ccsidekick/issues");
});

test("the issues link prints even when there is nothing to remove", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsk-uninst-")));
	let out = "";
	runUninstall({ settingsPath: join(dir, "absent.json"), out: (t) => (out += t) });
	expect(out).toContain("/issues");
});
