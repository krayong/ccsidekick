import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { claimFxRefresh, fixedClock } from "../sources";

import { runRefresh } from "./refresh";

const NOW = 1_700_000_000_000;

function okFetch(body: unknown): { fetchImpl: typeof fetch; count: () => number } {
	let calls = 0;
	const fetchImpl = (() => {
		calls += 1;
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(body),
		} as unknown as Response);
	}) as unknown as typeof fetch;
	return { fetchImpl, count: () => calls };
}

test("runRefresh fx <root> runs the claimed fx refresh to completion", async () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-refresh-"));
	const stub = okFetch({ rates: { USD: 1, INR: 84 } });
	try {
		expect(claimFxRefresh(root, fixedClock(NOW))).toBe(true);
		await runRefresh(["fx", root], fixedClock(NOW), stub.fetchImpl);
		expect(stub.count()).toBe(1);
		const cache = JSON.parse(readFileSync(join(root, "cache", "fx.json"), "utf8")) as {
			rates: Record<string, number>;
		};
		expect(cache.rates["INR"]).toBe(84);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runRefresh ignores an unknown kind or a missing root", async () => {
	const stub = okFetch({});
	await runRefresh(["bogus", "/tmp/x"], fixedClock(NOW), stub.fetchImpl);
	await runRefresh(["fx"], fixedClock(NOW), stub.fetchImpl);
	expect(stub.count()).toBe(0);
});
