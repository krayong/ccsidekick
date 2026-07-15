import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CREDS_TTL_MS } from "../domain";

import type { Clock } from "./clock";
import { KEYCHAIN_SERVICE, configBase, keychainService } from "./oauthUsage";
import { atomicWrite, cacheDir, readJson } from "./storage";

type SubscriptionType = "pro" | "max" | "team" | "enterprise";

/** Subscription tier read from the OAuth creds blob; `present` is true whenever any creds blob was found. */
export interface CredsInfo {
	readonly subscriptionType?: SubscriptionType;
	readonly present: boolean;
}

/** A credential-lookup subprocess runner: takes command + args, returns stdout ("" on any failure). */
export type Runner = (cmd: string, args: string[]) => string;

const SUBSCRIPTIONS: ReadonlySet<string> = new Set(["pro", "max", "team", "enterprise"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Default runner: `spawnSync` with a timeout; nonzero exit / error / throw ⇒ "". */
const defaultRunner: Runner = (cmd, args) => {
	try {
		const r = spawnSync(cmd, args, {
			encoding: "utf8",
			timeout: 1500,
			killSignal: "SIGKILL",
		});
		if (r.error || r.status !== 0) return "";
		return r.stdout;
	} catch {
		return "";
	}
};

/**
 * Best-effort read of the OAuth creds blob: macOS keychain (the config-scoped service Claude Code writes, then
 * the legacy bare service), else the creds file, else Linux secret-tool. `base` is the config dir.
 */
function readBlob(run: Runner, base: string): string {
	for (const service of [keychainService(base), KEYCHAIN_SERVICE]) {
		const keychain = run("security", ["find-generic-password", "-s", service, "-w"]);
		if (keychain.trim() !== "") return keychain;
	}
	try {
		const file = readFileSync(join(base, ".credentials.json"), "utf8");
		if (file.trim() !== "") return file;
	} catch {
		/* no creds file ⇒ fall through to secret-tool */
	}
	const secretTool = run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE]);
	if (secretTool.trim() !== "") return secretTool;
	return "";
}

/** The subscription tier named in a creds JSON blob, or undefined when absent/unrecognized. */
function parseSubscription(blob: string): SubscriptionType | undefined {
	const parsed: unknown = JSON.parse(blob);
	const oauth = isObject(parsed) ? parsed["claudeAiOauth"] : undefined;
	const raw = isObject(oauth) ? oauth["subscriptionType"] : undefined;
	if (typeof raw === "string" && SUBSCRIPTIONS.has(raw)) return raw as SubscriptionType;
	return undefined;
}

/**
 * The tier implied by a managed-OAuth profile's `.claude.json` `oauthAccount.organizationType`: Team/Enterprise
 * SSO logins carry no keychain `subscriptionType`, so their identity lives only here. Undefined on any read/parse
 * failure or a non-managed org. `base` is the config dir.
 */
function readOrgTier(base: string): SubscriptionType | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(base, ".claude.json"), "utf8"));
		const oauth = isObject(parsed) ? parsed["oauthAccount"] : undefined;
		const orgType = isObject(oauth) ? oauth["organizationType"] : undefined;
		if (orgType === "claude_enterprise") return "enterprise";
		if (orgType === "claude_team") return "team";
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Gated read of the OAuth subscription tier. Prefers the local creds blob (config-scoped keychain, legacy
 * keychain, creds file, or secret-tool); when no blob exists, falls back to the managed-OAuth identity in
 * `.claude.json` so Team/Enterprise SSO profiles resolve their tier. Never throws; returns `null` when nothing
 * is found or on any parse failure. Spawns keychain subprocesses, so the hot render path never calls this
 * directly — it reads `readCredsCached` and lets the persist tail refresh via `refreshCreds` (TTL-gated).
 */
export function readCreds(run: Runner = defaultRunner): CredsInfo | null {
	try {
		const base = configBase();
		const blob = readBlob(run, base);
		if (blob.trim() !== "") {
			const tier = parseSubscription(blob);
			return tier !== undefined ?
					{ present: true, subscriptionType: tier }
				:	{ present: true };
		}
		const org = readOrgTier(base);
		if (org !== undefined) return { present: true, subscriptionType: org };
		return null;
	} catch {
		return null;
	}
}

// ── Cached creds for the hot render path ────────────────────────────────────
// `readCreds` shells out to the keychain (1–3 subprocess spawns), so the render path must not call it every
// tick. Instead it reads a small on-disk cache synchronously (`readCredsCached`), and the persist tail
// refreshes that cache at most once per `CREDS_TTL_MS` (`refreshCreds`) — the subscription tier is near-static.

const CREDS_CACHE_FILE = "creds.json";

interface CachedCreds {
	readonly info: CredsInfo | null;
	readonly at: number;
}

function credsCachePath(root: string): string {
	return join(cacheDir(root), CREDS_CACHE_FILE);
}

function coerceCachedCreds(raw: unknown): CachedCreds | null {
	if (!isObject(raw) || typeof raw["at"] !== "number") return null;
	const at = raw["at"];
	const info = raw["info"];
	if (info === null) return { info: null, at };
	if (isObject(info) && typeof info["present"] === "boolean") {
		const sub = info["subscriptionType"];
		return {
			at,
			info:
				typeof sub === "string" && SUBSCRIPTIONS.has(sub) ?
					{ present: info["present"], subscriptionType: sub as SubscriptionType }
				:	{ present: info["present"] },
		};
	}
	return null;
}

/** The cached subscription tier for the hot render path; no keychain spawn. `null` until first refreshed. */
export function readCredsCached(root: string): CredsInfo | null {
	return coerceCachedCreds(readJson<unknown>(credsCachePath(root), undefined))?.info ?? null;
}

/** Persist-tail refresh: re-read the keychain and cache it when the cache is missing or older than the TTL. */
export function refreshCreds(root: string, clock: Clock, run: Runner = defaultRunner): void {
	const cached = coerceCachedCreds(readJson<unknown>(credsCachePath(root), undefined));
	const now = clock.now();
	if (cached !== null && now - cached.at <= CREDS_TTL_MS) return;
	const info = readCreds(run);
	try {
		atomicWrite(credsCachePath(root), JSON.stringify({ info, at: now }));
	} catch {
		/* best effort: a failed cache write just means the next tick refreshes again */
	}
}
