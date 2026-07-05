import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { fixedClock } from "./clock";
import {
	type UsageData,
	keychainService,
	keychainToken,
	parseOauth,
	readUsage,
	readUsageCached,
} from "./oauthUsage";

const NOW = 1_700_000_000_000;

const blob = (tok: string, exp: number) =>
	JSON.stringify({ claudeAiOauth: { accessToken: tok, expiresAt: exp } });

const legacyOnly = (s: string): string =>
	s === "Claude Code-credentials" ? blob("legacy", 500) : "";

function tmpRoot(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-usage-"));
}

function seedCache(root: string, data: UsageData, fetchedAt: number): void {
	const dir = join(root, "cache");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "usage.json"), JSON.stringify({ data, fetchedAt }));
}

function readCache(root: string): { data: UsageData; fetchedAt: number } {
	return JSON.parse(readFileSync(join(root, "cache", "usage.json"), "utf8")) as {
		data: UsageData;
		fetchedAt: number;
	};
}

interface Stub {
	fetchImpl: typeof fetch;
	count: () => number;
	lastInit: () => RequestInit | undefined;
}

function okStub(body: unknown): Stub {
	let calls = 0;
	let init: RequestInit | undefined;
	const fetchImpl = ((_url: string, requestInit?: RequestInit) => {
		calls += 1;
		init = requestInit;
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(body),
		} as unknown as Response);
	}) as unknown as typeof fetch;
	return { fetchImpl, count: () => calls, lastInit: () => init };
}

function failStub(): Stub {
	let calls = 0;
	const fetchImpl = (() => {
		calls += 1;
		return Promise.reject(new Error("network down"));
	}) as unknown as typeof fetch;
	// eslint-disable-next-line unicorn/no-useless-undefined -- explicit undefined matches the RequestInit | undefined return type
	return { fetchImpl, count: () => calls, lastInit: () => undefined };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

function withToken<T>(fn: () => Promise<T>): Promise<T> {
	const prev = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
	process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-token";
	return fn().finally(() => {
		if (prev === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
		else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = prev;
	});
}

const SAMPLE: UsageData = {
	rate_limits: { five_hour: { utilization: 12, resets_at: NOW + 1000 } },
};

test("keychainService namespaces the service by an 8-char sha256 of the config dir", () => {
	// Current Claude Code stores creds under "Claude Code-credentials-<sha256(configDir)[:8]>".
	expect(keychainService("/Users/krayong/.claude-personal")).toBe(
		"Claude Code-credentials-46d7fef9",
	);
});

test("parseOauth extracts token + expiresAt and rejects non-oauth blobs", () => {
	expect(
		parseOauth(JSON.stringify({ claudeAiOauth: { accessToken: "a", expiresAt: 9 } })),
	).toEqual({
		accessToken: "a",
		expiresAt: 9,
	});
	expect(parseOauth("garbage")).toBeUndefined();
	expect(parseOauth(JSON.stringify({ claudeAiOauth: {} }))).toBeUndefined();
});

test("keychainToken prefers the freshest token across the config-scoped and legacy services", () => {
	const cfg = "/Users/krayong/.claude-personal";
	const scoped = keychainService(cfg);
	// config-scoped entry is fresh, bare legacy entry is stale ⇒ pick the fresh scoped token
	const both = (s: string) =>
		s === scoped ? blob("fresh", 2000)
		: s === "Claude Code-credentials" ? blob("stale", 1000)
		: "";
	expect(keychainToken(both, cfg)).toBe("fresh");
	// only the legacy bare entry exists ⇒ fall back to it
	expect(keychainToken(legacyOnly, cfg)).toBe("legacy");
	// nothing readable ⇒ undefined; a non-oauth blob is ignored
	expect(keychainToken(() => "", cfg)).toBeUndefined();
	expect(keychainToken((s) => (s === scoped ? "not json" : ""), cfg)).toBeUndefined();
});

test("fresh cache ⇒ no fetch, returns cached data", async () => {
	const root = tmpRoot();
	seedCache(root, SAMPLE, NOW);
	const stub = okStub({ five_hour: { utilization: 99, resets_at: "2024-01-01T00:00:00Z" } });
	try {
		const data = await readUsage(root, fixedClock(NOW), {
			enabled: true,
			fetchImpl: stub.fetchImpl,
		});
		expect(stub.count()).toBe(0);
		expect(data?.rate_limits.five_hour?.utilization).toBe(12);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("enabled:false ⇒ never fetches", async () => {
	const root = tmpRoot();
	const stub = okStub({ five_hour: { utilization: 5, resets_at: "2024-01-01T00:00:00Z" } });
	try {
		const data = await readUsage(root, fixedClock(NOW), {
			enabled: false,
			fetchImpl: stub.fetchImpl,
		});
		await flush();
		expect(stub.count()).toBe(0);
		expect(data).toBeNull();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("stale + enabled ⇒ one fetch (single-flight), parses OAuth units, writes cache", async () => {
	const root = tmpRoot();
	const iso = "2024-06-01T12:00:00.000Z";
	const stub = okStub({
		five_hour: { utilization: 73.5, resets_at: iso },
		seven_day: { utilization: 40 },
		extra_usage: { used_credits: 250, monthly_limit: 1000, is_enabled: true },
	});
	const clock = fixedClock(NOW);
	try {
		await withToken(async () => {
			await Promise.all([
				readUsage(root, clock, {
					enabled: true,
					version: "1.2.3",
					fetchImpl: stub.fetchImpl,
				}),
				readUsage(root, clock, {
					enabled: true,
					version: "1.2.3",
					fetchImpl: stub.fetchImpl,
				}),
			]);
			await flush();
		});
		expect(stub.count()).toBe(1);
		const cached = readCache(root);
		// OAuth utilization (NOT used_percentage); ISO resets_at parsed to epoch MS (NOT seconds)
		expect(cached.data.rate_limits.five_hour?.utilization).toBe(73.5);
		expect(cached.data.rate_limits.five_hour?.resets_at).toBe(Date.parse(iso));
		expect(cached.data.rate_limits.seven_day?.resets_at).toBeUndefined();
		expect(cached.data.extra_usage?.is_enabled).toBe(true);
		expect(cached.data.extra_usage?.used_credits).toBe(250);
		// User-Agent carries the payload version
		const headers = stub.lastInit()?.headers as Record<string, string> | undefined;
		expect(headers?.["User-Agent"]).toBe("claude-code/1.2.3");
		expect(headers?.["Authorization"]).toBe("Bearer test-token");
		expect(headers?.["anthropic-beta"]).toBe("oauth-2025-04-20");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed resets_at string ⇒ treated as missing, not epoch 0", async () => {
	const root = tmpRoot();
	const stub = okStub({ five_hour: { utilization: 10, resets_at: "not-a-date" } });
	try {
		await withToken(async () => {
			await readUsage(root, fixedClock(NOW), {
				enabled: true,
				version: "9",
				fetchImpl: stub.fetchImpl,
			});
			await flush();
		});
		const cached = readCache(root);
		expect(cached.data.rate_limits.five_hour?.utilization).toBe(10);
		expect(cached.data.rate_limits.five_hour?.resets_at).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fetch failure ⇒ serves stale cached data without throwing", async () => {
	const root = tmpRoot();
	seedCache(root, SAMPLE, 0); // stale
	const stub = failStub();
	try {
		const data = await withToken(() =>
			readUsage(root, fixedClock(NOW), {
				enabled: true,
				version: "1",
				fetchImpl: stub.fetchImpl,
			}),
		);
		await flush();
		expect(stub.count()).toBe(1);
		expect(data?.rate_limits.five_hour?.utilization).toBe(12); // stale served
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failed refresh does not suppress retry for the full TTL", async () => {
	const root = tmpRoot();
	seedCache(root, SAMPLE, 0); // stale ⇒ eligible
	const stub = failStub();
	const DAY = 86_400_000;
	try {
		await withToken(async () => {
			await readUsage(root, fixedClock(NOW), {
				enabled: true,
				version: "1",
				fetchImpl: stub.fetchImpl,
			});
			await flush();
			expect(stub.count()).toBe(1);
			// A later tick past the short backoff retries; under the bug the stamp holds for the full TTL.
			await readUsage(root, fixedClock(NOW + DAY), {
				enabled: true,
				version: "1",
				fetchImpl: stub.fetchImpl,
			});
			await flush();
			expect(stub.count()).toBe(2);
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("refresh passes an abort-timeout signal to fetch", async () => {
	const root = tmpRoot();
	const stub = okStub({ five_hour: { utilization: 5 } });
	try {
		await withToken(async () => {
			await readUsage(root, fixedClock(NOW), {
				enabled: true,
				version: "1",
				fetchImpl: stub.fetchImpl,
			});
			await flush();
		});
		expect(stub.lastInit()?.signal).toBeInstanceOf(AbortSignal);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readUsageCached: returns the cached data synchronously, null when absent", () => {
	const root = tmpRoot();
	try {
		expect(readUsageCached(root)).toBeNull(); // no cache yet
		seedCache(root, SAMPLE, NOW);
		expect(readUsageCached(root)?.rate_limits.five_hour?.utilization).toBe(12);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
