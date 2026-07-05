import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { backoffStamp, singleFlight } from "./singleFlight";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

test("singleFlight gates one writer per TTL", () => {
	const stamp = join(track(mkdtempSync(join(tmpdir(), "cc-"))), "fx.stamp");
	// First call: no stamp yet ⇒ proceeds and stamps.
	expect(singleFlight(stamp, 10_000, Date.now())).toBe(true);
	// Subsequent `now` values are measured against the stamp's real fs mtime.
	const mtime = statSync(stamp).mtimeMs;
	expect(singleFlight(stamp, 10_000, mtime + 5_000)).toBe(false); // within TTL
	expect(singleFlight(stamp, 10_000, mtime + 20_000)).toBe(true); // past TTL
});

test("singleFlight creates a missing parent dir on first stamp", () => {
	const stamp = join(track(mkdtempSync(join(tmpdir(), "cc-"))), "nested", "fx.stamp");
	expect(singleFlight(stamp, 10_000, Date.now())).toBe(true);
});

test("backoffStamp rolls a claimed stamp back to a short retry window", () => {
	const stamp = join(track(mkdtempSync(join(tmpdir(), "cc-"))), "fx.stamp");
	const NOW = 1_700_000_000_000;
	const TTL = 604_800_000; // 7 days
	const BACKOFF = 30_000;
	// Claim the slot (a fresh stamp holds off retries for the full TTL).
	expect(singleFlight(stamp, TTL, NOW)).toBe(true);
	// A failed refresh rolls the stamp back so retry is suppressed for only the backoff window.
	backoffStamp(stamp, TTL, BACKOFF, NOW);
	expect(singleFlight(stamp, TTL, NOW + BACKOFF - 5_000)).toBe(false); // still within backoff
	expect(singleFlight(stamp, TTL, NOW + BACKOFF + 5_000)).toBe(true); // past backoff ⇒ retry
});

test("backoffStamp on a missing stamp is a no-op that never throws", () => {
	const stamp = join(track(mkdtempSync(join(tmpdir(), "cc-"))), "absent.stamp");
	expect(() => {
		backoffStamp(stamp, 10_000, 1_000, Date.now());
	}).not.toThrow();
});
