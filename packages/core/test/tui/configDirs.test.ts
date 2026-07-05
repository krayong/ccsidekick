import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { discoverConfigDirs, tildePath } from "../../src/tui";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

/** Mark a dir as a real Claude config dir by giving it a settings.json. */
function wire(dir: string): string {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), "{}");
	return dir;
}

/**
 * A temp $HOME with two wired config dirs (`.claude`, `.claude-work`), a `.claude*` dir WITHOUT a settings.json
 * (`.claude-empty`), a non-`.claude` dir, and a `.claude*`-named regular file.
 */
function fixtureHome(): string {
	const home = track(mkdtempSync(join(tmpdir(), "cc-home-")));
	wire(join(home, ".claude"));
	wire(join(home, ".claude-work"));
	mkdirSync(join(home, ".claude-empty"));
	mkdirSync(join(home, "projects"));
	writeFileSync(join(home, ".clauderc"), "x");
	return home;
}

test("lists only .claude* dirs that hold a settings.json, deduped and sorted", () => {
	const home = fixtureHome();
	const { dirs } = discoverConfigDirs(home);
	// .claude-empty has no settings.json ⇒ excluded; projects/.clauderc never qualify.
	expect(dirs).toEqual([join(home, ".claude"), join(home, ".claude-work")]);
});

test("no suggested → ~/.claude is the preselected index", () => {
	const home = fixtureHome();
	const { dirs, suggestedIndex } = discoverConfigDirs(home);
	expect(dirs[suggestedIndex]).toBe(join(home, ".claude"));
});

test("suggested present in the list → its index is reported", () => {
	const home = fixtureHome();
	const suggested = join(home, ".claude-work");
	const { dirs, suggestedIndex } = discoverConfigDirs(home, suggested);
	expect(dirs[suggestedIndex]).toBe(suggested);
});

test("a suggested dir with a settings.json outside $HOME is listed", () => {
	const home = fixtureHome();
	const suggested = wire(track(mkdtempSync(join(tmpdir(), "cc-sug-"))));
	const { dirs, suggestedIndex } = discoverConfigDirs(home, suggested);
	expect(dirs).toContain(suggested);
	expect(dirs[suggestedIndex]).toBe(suggested);
});

test("a suggested dir without a settings.json is excluded; preselect falls back to ~/.claude", () => {
	const home = fixtureHome();
	const suggested = track(mkdtempSync(join(tmpdir(), "cc-bare-"))); // no settings.json
	const { dirs, suggestedIndex } = discoverConfigDirs(home, suggested);
	expect(dirs).not.toContain(suggested);
	expect(dirs[suggestedIndex]).toBe(join(home, ".claude"));
});

test("a missing/unreadable $HOME (no wired dirs) yields an empty list", () => {
	const { dirs, suggestedIndex } = discoverConfigDirs("/nonexistent-home-xyz");
	expect(dirs).toEqual([]);
	expect(suggestedIndex).toBe(0);
});

test("compresses the home prefix to ~", () => {
	expect(tildePath("/Users/krayong/.claude-personal", "/Users/krayong")).toBe(
		"~/.claude-personal",
	);
});

test("the home dir itself becomes ~", () => {
	expect(tildePath("/Users/krayong", "/Users/krayong")).toBe("~");
});

test("a path outside home is returned unchanged", () => {
	expect(tildePath("/etc/claude", "/Users/krayong")).toBe("/etc/claude");
});

test("a home with a trailing slash still matches", () => {
	expect(tildePath("/Users/krayong/.claude", "/Users/krayong/")).toBe("~/.claude");
});

test("a sibling dir sharing a name prefix is not compressed", () => {
	expect(tildePath("/Users/krayong-work/.claude", "/Users/krayong")).toBe(
		"/Users/krayong-work/.claude",
	);
});
