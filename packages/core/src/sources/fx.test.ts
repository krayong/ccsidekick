import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { fixedClock } from "./clock";
import { readFx, readFxCached } from "./fx";

const NOW = 1_700_000_000_000;

function tmpRoot(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-fx-"));
}

function seedCache(root: string, body: unknown): void {
	const dir = join(root, "cache");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "fx.json"), JSON.stringify(body));
}

function readCache(root: string): {
	rates: Record<string, number>;
	fetchedAt: number;
	nextUpdateAt: number;
} {
	return JSON.parse(readFileSync(join(root, "cache", "fx.json"), "utf8")) as {
		rates: Record<string, number>;
		fetchedAt: number;
		nextUpdateAt: number;
	};
}

interface Stub {
	fetchImpl: typeof fetch;
	count: () => number;
}

function okStub(body: unknown): Stub {
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

function failStub(): Stub {
	let calls = 0;
	const fetchImpl = (() => {
		calls += 1;
		return Promise.reject(new Error("network down"));
	}) as unknown as typeof fetch;
	return { fetchImpl, count: () => calls };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

test("fresh cache ⇒ no fetch, returns fallback merged with cache", async () => {
	const root = tmpRoot();
	seedCache(root, { rates: { EUR: 0.5 }, fetchedAt: NOW, nextUpdateAt: NOW + 1_000_000 });
	const stub = okStub({ rates: { EUR: 9 } });
	try {
		const table = await readFx(root, fixedClock(NOW), {
			enabled: true,
			fetchImpl: stub.fetchImpl,
		});
		expect(stub.count()).toBe(0);
		expect(table["EUR"]).toBe(0.5); // cache wins over bundled fallback
		expect(table["USD"]).toBe(1); // bundled fallback still present
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("enabled:false ⇒ never fetches even when stale", async () => {
	const root = tmpRoot();
	seedCache(root, { rates: { EUR: 0.5 }, fetchedAt: 0, nextUpdateAt: 0 });
	const stub = okStub({ rates: { EUR: 9 } });
	try {
		await readFx(root, fixedClock(NOW), { enabled: false, fetchImpl: stub.fetchImpl });
		await flush();
		expect(stub.count()).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("stale + enabled ⇒ exactly one fetch (single-flight) and atomic cache write", async () => {
	const root = tmpRoot();
	const stub = okStub({
		rates: { EUR: 0.9, GBP: 0.8 },
		time_next_update_unix: NOW / 1000 + 86_400, // +1 day in epoch SECONDS
	});
	const clock = fixedClock(NOW);
	try {
		await Promise.all([
			readFx(root, clock, { enabled: true, fetchImpl: stub.fetchImpl }),
			readFx(root, clock, { enabled: true, fetchImpl: stub.fetchImpl }),
		]);
		await flush();
		expect(stub.count()).toBe(1);
		const cache = readCache(root);
		expect(cache.rates["EUR"]).toBe(0.9);
		// daily endpoint floored to the 7-day TTL: fetchedAt + FX_TTL_MS
		expect(cache.nextUpdateAt).toBe(NOW + 604_800_000);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fetch failure ⇒ falls back to bundled without throwing", async () => {
	const root = tmpRoot();
	const stub = failStub();
	try {
		const table = await readFx(root, fixedClock(NOW), {
			enabled: true,
			fetchImpl: stub.fetchImpl,
		});
		await flush();
		expect(table["USD"]).toBe(1);
		expect(stub.count()).toBe(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("refreshed rates: a non-finite/≤0 entry is dropped, the rest are kept", async () => {
	const root = tmpRoot();
	seedCache(root, { rates: { EUR: 0.5 }, fetchedAt: 0, nextUpdateAt: 0 });
	const stub = okStub({ rates: { EUR: 0.9, BAD: 0, GBP: 0.8 } });
	try {
		await readFx(root, fixedClock(NOW), { enabled: true, fetchImpl: stub.fetchImpl });
		await flush();
		const cache = readCache(root);
		expect(cache.rates["EUR"]).toBe(0.9); // valid entries refreshed
		expect(cache.rates["GBP"]).toBe(0.8);
		expect(cache.rates["BAD"]).toBeUndefined(); // offending entry dropped, not the whole table
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("refreshed rates with no usable entry ⇒ whole refresh discarded, cache untouched", async () => {
	const root = tmpRoot();
	seedCache(root, { rates: { EUR: 0.5 }, fetchedAt: 0, nextUpdateAt: 0 });
	const stub = okStub({ rates: { BAD: 0, WORSE: -1 } });
	try {
		await readFx(root, fixedClock(NOW), { enabled: true, fetchImpl: stub.fetchImpl });
		await flush();
		expect(readCache(root).rates["EUR"]).toBe(0.5); // unchanged
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failed refresh does not suppress retry for the full TTL", async () => {
	const root = tmpRoot();
	seedCache(root, { rates: { EUR: 0.5 }, fetchedAt: 0, nextUpdateAt: 0 }); // stale ⇒ eligible
	const stub = failStub();
	const DAY = 86_400_000;
	try {
		await readFx(root, fixedClock(NOW), { enabled: true, fetchImpl: stub.fetchImpl });
		await flush();
		expect(stub.count()).toBe(1);
		// A later tick past the short backoff retries; under the bug the stamp holds for the 7-day TTL.
		await readFx(root, fixedClock(NOW + DAY), { enabled: true, fetchImpl: stub.fetchImpl });
		await flush();
		expect(stub.count()).toBe(2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("refresh passes an abort-timeout signal to fetch", async () => {
	const root = tmpRoot();
	let signal: AbortSignal | undefined;
	const fetchImpl = ((_url: string, init?: RequestInit) => {
		signal = init?.signal ?? undefined;
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve({ rates: { EUR: 1 } }),
		} as unknown as Response);
	}) as unknown as typeof fetch;
	try {
		await readFx(root, fixedClock(NOW), { enabled: true, fetchImpl });
		await flush();
		expect(signal).toBeInstanceOf(AbortSignal);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readFxCached: bundled fallback merged over the cache, no refresh fired", () => {
	const root = tmpRoot();
	try {
		const bundled = readFxCached(root); // no cache yet ⇒ pure fallback
		expect(bundled["USD"]).toBe(1);
		expect(bundled["INR"]).toBeGreaterThan(0);
		seedCache(root, { rates: { INR: 1 }, fetchedAt: NOW, nextUpdateAt: NOW + 1 });
		expect(readFxCached(root)["INR"]).toBe(1); // cached override wins
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
