import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { runGc } from "../../src/cli";
import { type CostCache, fixedClock } from "../../src/sources";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const DAY_MS = 86_400_000;

function tmpRoot(): string {
	return join(track(mkdtempSync(join(tmpdir(), "cc-gc-"))), "ccsidekick");
}

function writeSession(root: string, id: string, mtimeMs: number): string {
	const dir = join(root, "sessions", id);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "events.jsonl");
	writeFileSync(file, `${JSON.stringify({ ts: mtimeMs, category: "git_push" })}\n`);
	const sec = mtimeMs / 1000;
	utimesSync(file, sec, sec); // file first (writing the file bumps the dir mtime)
	utimesSync(dir, sec, sec);
	return dir;
}

function costEntry(): CostCache["files"][string] {
	return {
		mtime: 1,
		size: 1,
		total: 1,
		lines: [],
		models: [],
		projectPath: "/p",
		record: {
			session: "s" as never,
			project: "p" as never,
			start: 0,
			end: 1,
			tokens: { input: 1, output: 1, cache_read: 0, cache_creation: 0 },
			messages: 1,
		},
	};
}

test("prunes a stale session dir, keeps a fresh one", () => {
	const root = tmpRoot();
	const now = 1_000 * DAY_MS;
	const old = writeSession(root, "old", now - 31 * DAY_MS);
	const fresh = writeSession(root, "fresh", now - 1 * DAY_MS);
	runGc(root, fixedClock(now));
	expect(existsSync(old)).toBe(false);
	expect(existsSync(fresh)).toBe(true);
});

test("drops a cost-cache entry whose transcript has vanished, keeps a live one", () => {
	const root = tmpRoot();
	const liveDir = track(mkdtempSync(join(tmpdir(), "cc-live-")));
	const live = join(liveDir, "live.jsonl");
	writeFileSync(live, "x");
	const gone = join(liveDir, "gone.jsonl"); // never created

	const cache: CostCache = {
		files: { [live]: costEntry(), [gone]: costEntry() },
		aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
		lastScanTs: 5,
	};
	mkdirSync(join(root, "cache"), { recursive: true });
	writeFileSync(join(root, "cache/cost.json"), JSON.stringify(cache));

	runGc(root, fixedClock(0));

	const after = JSON.parse(readFileSync(join(root, "cache/cost.json"), "utf8")) as CostCache;
	expect(Object.keys(after.files)).toEqual([live]);
});

test("never touches analytics/store.json", () => {
	const root = tmpRoot();
	mkdirSync(join(root, "analytics"), { recursive: true });
	const store = join(root, "analytics/store.json");
	const content = JSON.stringify({ sentinel: true });
	writeFileSync(store, content);
	// also give it something to prune so GC actually runs work
	writeSession(root, "old", 0);
	runGc(root, fixedClock(1_000 * DAY_MS));
	expect(readFileSync(store, "utf8")).toBe(content);
});

test("a missing root is a no-op, never throws", () => {
	const root = join(tmpdir(), "cc-gc-absent", String(Date.now()));
	expect(() => {
		runGc(root, fixedClock(0));
	}).not.toThrow();
});
