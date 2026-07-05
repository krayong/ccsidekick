import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { appendBounded } from "./appendBounded";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

test("appendBounded trims to max lines", () => {
	const p = join(track(mkdtempSync(join(tmpdir(), "cc-"))), "e.jsonl");
	for (let i = 0; i < 5; i++) appendBounded(p, `line${i}`, 3);
	expect(readFileSync(p, "utf8").trim().split("\n")).toEqual(["line2", "line3", "line4"]);
});

test("appendBounded creates a missing parent dir", () => {
	const p = join(track(mkdtempSync(join(tmpdir(), "cc-"))), "nested", "deep", "e.jsonl");
	appendBounded(p, "only", 3);
	expect(readFileSync(p, "utf8")).toBe("only\n");
});
