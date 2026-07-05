import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { chipFor, projectTarget, type SaveTarget } from "../../../src/tui/shell";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const g = (dir: string): SaveTarget => ({ dir, scope: "global" });
const l = (dir: string): SaveTarget => ({ dir, scope: "local", cwd: dir });

test("chipFor is global/local/mixed", () => {
	expect(chipFor([g("/a"), g("/b")])).toBe("global");
	expect(chipFor([l("/p")])).toBe("local");
	expect(chipFor([g("/a"), l("/p")])).toBe("mixed");
});

test("projectTarget offers to wire settings.json when the project is unwired", () => {
	const cwd = track(mkdtempSync(join(tmpdir(), "ccsk-proj-")));
	expect(projectTarget(cwd, "/home")).toEqual({
		dir: join(cwd, ".claude"),
		scope: "local",
		cwd,
		wireLocalSettings: true,
	});
});

test("projectTarget still offers to wire settings.json that exists but isn't ccsidekick's", () => {
	const cwd = track(mkdtempSync(join(tmpdir(), "ccsk-proj-")));
	mkdirSync(join(cwd, ".claude"), { recursive: true });
	writeFileSync(join(cwd, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
	expect(projectTarget(cwd, "/home")).toEqual({
		dir: join(cwd, ".claude"),
		scope: "local",
		cwd,
		wireLocalSettings: true,
	});
});

test("projectTarget leaves settings.json alone when the project is already wired", () => {
	const cwd = track(mkdtempSync(join(tmpdir(), "ccsk-proj-")));
	mkdirSync(join(cwd, ".claude"), { recursive: true });
	writeFileSync(
		join(cwd, ".claude", "settings.json"),
		JSON.stringify({ statusLine: { command: "/abs/ccsidekick-render render" } }),
	);
	expect(projectTarget(cwd, "/home")).toEqual({
		dir: join(cwd, ".claude"),
		scope: "local",
		cwd,
		wireLocalSettings: false,
	});
});
