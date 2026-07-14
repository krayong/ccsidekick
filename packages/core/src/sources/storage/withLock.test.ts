import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { withLock } from "./withLock";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

test("runs fn when free; readOnly when held", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const lock = join(dir, "x.lock");
	expect(
		withLock(
			lock,
			() => "wrote",
			() => "ro",
		),
	).toBe("wrote");
	writeFileSync(lock, ""); // simulate held
	expect(
		withLock(
			lock,
			() => "wrote",
			() => "ro",
		),
	).toBe("ro");
});

test("creates missing parent dir before acquiring", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const lock = join(dir, "fresh", "nested", "x.lock");
	expect(
		withLock(
			lock,
			() => "wrote",
			() => "ro",
		),
	).toBe("wrote");
});

test("steals a stale lock older than 30s", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const lock = join(dir, "x.lock");
	writeFileSync(lock, "");
	const old = Date.now() / 1000 - 60;
	utimesSync(lock, old, old);
	expect(
		withLock(
			lock,
			() => "wrote",
			() => "ro",
		),
	).toBe("wrote");
});

test("a stale reclaim cleans up its .stale sidecar (no leftover)", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const lock = join(dir, "x.lock");
	writeFileSync(lock, "");
	const old = Date.now() / 1000 - 60;
	utimesSync(lock, old, old);
	withLock(
		lock,
		() => "wrote",
		() => "ro",
	);
	expect(existsSync(`${lock}.stale`)).toBe(false);
	expect(existsSync(lock)).toBe(false); // released after fn
});

test("releases the lock when fn throws, then rethrows", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const lock = join(dir, "x.lock");
	expect(() =>
		withLock(
			lock,
			() => {
				throw new Error("boom");
			},
			() => "ro",
		),
	).toThrow("boom");
	// the `finally` released the lock, so a later writer acquires it and runs fn (not the read-only fallback)
	// — a leaked lock would wedge every later writer into read-only until it went stale.
	expect(
		withLock(
			lock,
			() => "wrote",
			() => "ro",
		),
	).toBe("wrote");
});

test("mkdirSync failure (parent is a file) ⇒ readOnly, fn never runs", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "cc-")));
	const notADir = join(dir, "file");
	writeFileSync(notADir, ""); // a regular file where withLock expects a directory
	// dirname is `<file>/sub`, so mkdirSync recursing through the file throws ENOTDIR.
	const lock = join(notADir, "sub", "x.lock");
	let ran = false;
	expect(
		withLock(
			lock,
			() => {
				ran = true;
				return "wrote";
			},
			() => "ro",
		),
	).toBe("ro");
	expect(ran).toBe(false);
});
