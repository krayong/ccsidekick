import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { fixedClock } from "./clock";
import { type Runner, readCreds, readCredsCached, refreshCreds } from "./creds";
import { keychainService } from "./oauthUsage";

const blob = (sub: unknown): string =>
	JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: sub } });

/** Run env mutation for a config-dir-scoped test, restoring the prior value afterward. */
function withConfigDir(dir: string, fn: () => void): void {
	const prev = process.env["CLAUDE_CONFIG_DIR"];
	process.env["CLAUDE_CONFIG_DIR"] = dir;
	try {
		fn();
	} finally {
		if (prev === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
		else process.env["CLAUDE_CONFIG_DIR"] = prev;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("refreshCreds caches the tier (TTL-gated); readCredsCached serves it without spawning (P8)", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-creds-cache-"));
	try {
		let spawns = 0;
		const run: Runner = (cmd) => {
			spawns += 1;
			return cmd === "security" ? blob("max") : "";
		};
		expect(readCredsCached(root)).toBeNull(); // nothing cached yet ⇒ hot path reads null, no spawn
		refreshCreds(root, fixedClock(1000), run);
		expect(spawns).toBeGreaterThan(0); // cold cache ⇒ refreshed once
		expect(readCredsCached(root)).toEqual({ present: true, subscriptionType: "max" });
		const after = spawns;
		refreshCreds(root, fixedClock(1000 + 60_000), run); // within the 1h TTL
		expect(spawns).toBe(after); // no re-spawn
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("keychain blob ⇒ parses subscriptionType, present true", () => {
	// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
	const run: Runner = (cmd) => (cmd === "security" ? blob("max") : "");
	const info = readCreds(run);
	expect(info).toEqual({ present: true, subscriptionType: "max" });
});

test("blob without a valid subscriptionType ⇒ present true, no tier", () => {
	// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
	const run: Runner = (cmd) => (cmd === "security" ? blob("bogus") : "");
	expect(readCreds(run)).toEqual({ present: true });
});

test("throwing runner ⇒ null and never throws", () => {
	// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
	const run: Runner = () => {
		throw new Error("spawn failed");
	};
	expect(() => readCreds(run)).not.toThrow();
	expect(readCreds(run)).toBeNull();
});

test("no keychain, no creds file, no secret-tool ⇒ null", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-creds-"));
	const prev = process.env["CLAUDE_CONFIG_DIR"];
	process.env["CLAUDE_CONFIG_DIR"] = dir;
	try {
		const run: Runner = () => "";
		expect(readCreds(run)).toBeNull();
	} finally {
		if (prev === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
		else process.env["CLAUDE_CONFIG_DIR"] = prev;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("creds-file fallback when keychain/secret-tool empty", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-creds-"));
	writeFileSync(join(dir, ".credentials.json"), blob("team"));
	withConfigDir(dir, () => {
		// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
		const run: Runner = () => "";
		expect(readCreds(run)).toEqual({ present: true, subscriptionType: "team" });
	});
});

test("reads the config-dir-scoped keychain service, not just the legacy bare name", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-creds-"));
	const scoped = keychainService(dir);
	withConfigDir(dir, () => {
		// Only the hashed, config-scoped service yields a blob; the legacy bare service returns nothing.
		// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
		const run: Runner = (cmd, args) =>
			cmd === "security" && args.includes(scoped) ? blob("enterprise") : "";
		expect(readCreds(run)).toEqual({ present: true, subscriptionType: "enterprise" });
	});
});

test("enterprise identity from .claude.json oauthAccount when no keychain/creds", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-creds-"));
	writeFileSync(
		join(dir, ".claude.json"),
		JSON.stringify({ oauthAccount: { organizationType: "claude_enterprise" } }),
	);
	withConfigDir(dir, () => {
		// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
		const run: Runner = () => "";
		expect(readCreds(run)).toEqual({ present: true, subscriptionType: "enterprise" });
	});
});

test("team identity from .claude.json oauthAccount when no keychain/creds", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-creds-"));
	writeFileSync(
		join(dir, ".claude.json"),
		JSON.stringify({ oauthAccount: { organizationType: "claude_team" } }),
	);
	withConfigDir(dir, () => {
		// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
		const run: Runner = () => "";
		expect(readCreds(run)).toEqual({ present: true, subscriptionType: "team" });
	});
});

test("keychain tier wins over .claude.json oauthAccount", () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-creds-"));
	writeFileSync(
		join(dir, ".claude.json"),
		JSON.stringify({ oauthAccount: { organizationType: "claude_enterprise" } }),
	);
	withConfigDir(dir, () => {
		// eslint-disable-next-line unicorn/consistent-function-scoping -- the name run is reused across tests, cannot share one module-scope binding
		const run: Runner = (cmd) => (cmd === "security" ? blob("max") : "");
		expect(readCreds(run)).toEqual({ present: true, subscriptionType: "max" });
	});
});
