import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { atomicWrite } from "./atomicWrite";
import { readJson } from "./readJson";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

test("atomicWrite creates parent dirs and round-trips via readJson", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const p = join(dir, "nested", "x.json");
	atomicWrite(p, JSON.stringify({ a: 1 }));
	expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ a: 1 });
	expect(readJson(p, { a: 0 })).toEqual({ a: 1 });
});

test("readJson returns the default when the file is missing", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	expect(readJson(join(dir, "missing.json"), { a: 0 })).toEqual({ a: 0 });
});

test("readJson returns the default when the file holds invalid JSON", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const p = join(dir, "x.json");
	atomicWrite(p, "{ broken");
	expect(readJson(p, { a: 9 })).toEqual({ a: 9 });
});
