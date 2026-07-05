import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { readBalance } from "./balance";
import { fixedClock } from "./clock";

const NOW = 1_700_000_000_000;

function snapshotFile(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-bal-"));
	const path = join(dir, "balance.json");
	writeFileSync(path, body);
	return path;
}

test("fresh snapshot within freshness ⇒ returns it", () => {
	const path = snapshotFile(JSON.stringify({ amount: 42.5, currency: "USD", ts: NOW - 1000 }));
	try {
		expect(readBalance(path, fixedClock(NOW))).toEqual({
			amount: 42.5,
			currency: "USD",
			ts: NOW - 1000,
		});
	} finally {
		rmSync(path, { force: true });
	}
});

test("stale snapshot older than BALANCE_FRESHNESS_MS ⇒ null", () => {
	const path = snapshotFile(JSON.stringify({ amount: 1, currency: "USD", ts: NOW - 300_001 }));
	try {
		expect(readBalance(path, fixedClock(NOW))).toBeNull();
	} finally {
		rmSync(path, { force: true });
	}
});

test("empty path ⇒ null", () => {
	expect(readBalance("", fixedClock(NOW))).toBeNull();
});

test("missing file ⇒ null", () => {
	expect(readBalance(join(tmpdir(), "ccsk-no-such-balance.json"), fixedClock(NOW))).toBeNull();
});

test("malformed shape ⇒ null", () => {
	const path = snapshotFile(JSON.stringify({ amount: "lots", currency: "USD", ts: NOW }));
	try {
		expect(readBalance(path, fixedClock(NOW))).toBeNull();
	} finally {
		rmSync(path, { force: true });
	}
});
