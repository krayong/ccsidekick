import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { USAGE_TTL_MS } from "../domain";

import type { Clock } from "./clock";
import { atomicWrite, backoffStamp, cacheDir, readJson, singleFlight } from "./storage";

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * A single OAuth quota window. `utilization` is 0–100 (the OAuth field name, NOT the payload's
 * `used_percentage`); `resets_at` is epoch **ms** (parsed from the OAuth ISO-8601 string, NOT epoch seconds).
 */
export interface OAuthQuota {
	readonly utilization: number;
	readonly resets_at?: number;
}

/** Pay-as-you-go usage; present only on the OAuth response, never on the stdin payload. */
interface ExtraUsage {
	readonly used_credits?: number;
	readonly monthly_limit?: number;
	readonly is_enabled?: boolean;
}

/** The OAuth usage response narrowed into a payload-mirroring shape (quotas wrapped under `rate_limits`). */
export interface UsageData {
	readonly rate_limits: {
		readonly five_hour?: OAuthQuota;
		readonly seven_day?: OAuthQuota;
	};
	readonly extra_usage?: ExtraUsage;
}

interface UsageCache {
	readonly data: UsageData;
	readonly fetchedAt: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asNumber = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined;
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
	value !== undefined ? ({ [key]: value } as Record<K, V>) : {};

/** Parse a quota straight from the OAuth response: ISO-8601 `resets_at` string → epoch ms (NaN ⇒ absent). */
function parseFetchedQuota(v: unknown): OAuthQuota | undefined {
	if (!isObject(v)) return undefined;
	const utilization = asNumber(v["utilization"]);
	if (utilization === undefined) return undefined;
	const raw = v["resets_at"];
	let resets_at: number | undefined;
	if (typeof raw === "string") {
		const parsed = Date.parse(raw);
		if (Number.isFinite(parsed)) resets_at = parsed;
	}
	return { utilization, ...opt("resets_at", resets_at) };
}

/** Coerce a quota from the on-disk cache, where `resets_at` is already a stored epoch-ms number. */
function coerceStoredQuota(v: unknown): OAuthQuota | undefined {
	if (!isObject(v)) return undefined;
	const utilization = asNumber(v["utilization"]);
	if (utilization === undefined) return undefined;
	return { utilization, ...opt("resets_at", asNumber(v["resets_at"])) };
}

function parseExtra(v: unknown): ExtraUsage | undefined {
	if (!isObject(v)) return undefined;
	const used_credits = asNumber(v["used_credits"]);
	const monthly_limit = asNumber(v["monthly_limit"]);
	const isEnabled = v["is_enabled"];
	const is_enabled = typeof isEnabled === "boolean" ? isEnabled : undefined;
	if (used_credits === undefined && monthly_limit === undefined && is_enabled === undefined) {
		return undefined;
	}
	return {
		...opt("used_credits", used_credits),
		...opt("monthly_limit", monthly_limit),
		...opt("is_enabled", is_enabled),
	};
}

/** Narrow the raw OAuth response (top-level `five_hour`/`seven_day`/`extra_usage`) into `UsageData`. */
function parseFetchedUsage(v: unknown): UsageData | null {
	if (!isObject(v)) return null;
	const five = parseFetchedQuota(v["five_hour"]);
	const seven = parseFetchedQuota(v["seven_day"]);
	const extra = parseExtra(v["extra_usage"]);
	if (five === undefined && seven === undefined && extra === undefined) return null;
	return {
		rate_limits: { ...opt("five_hour", five), ...opt("seven_day", seven) },
		...opt("extra_usage", extra),
	};
}

/** Shape-validate the cached `UsageData`; `readJson` only catches parse errors. */
function coerceStoredUsage(v: unknown): UsageData | null {
	if (!isObject(v)) return null;
	const rl = isObject(v["rate_limits"]) ? v["rate_limits"] : {};
	const five = coerceStoredQuota(rl["five_hour"]);
	const seven = coerceStoredQuota(rl["seven_day"]);
	const extra = parseExtra(v["extra_usage"]);
	return {
		rate_limits: { ...opt("five_hour", five), ...opt("seven_day", seven) },
		...opt("extra_usage", extra),
	};
}

const usagePath = (root: string): string => join(cacheDir(root), "usage.json");
const usageStamp = (root: string): string => join(cacheDir(root), "usage.stamp");

function readCachedUsage(root: string): UsageCache | null {
	const raw = readJson<unknown>(usagePath(root), undefined);
	if (!isObject(raw)) return null;
	const fetchedAt = asNumber(raw["fetchedAt"]);
	const data = coerceStoredUsage(raw["data"]);
	if (fetchedAt === undefined || data === null) return null;
	return { data, fetchedAt };
}

/** A parsed Claude Code OAuth credential. `expiresAt` is epoch ms; 0 when the field is absent. */
interface OauthToken {
	readonly accessToken: string;
	readonly expiresAt: number;
}

/** Extract `claudeAiOauth.{accessToken,expiresAt}` from a creds JSON blob; undefined on any failure. */
export function parseOauth(blob: string): OauthToken | undefined {
	try {
		const parsed: unknown = JSON.parse(blob);
		const oauth = isObject(parsed) ? parsed["claudeAiOauth"] : undefined;
		if (!isObject(oauth)) return undefined;
		const tok = oauth["accessToken"];
		if (typeof tok !== "string" || tok === "") return undefined;
		return { accessToken: tok, expiresAt: asNumber(oauth["expiresAt"]) ?? 0 };
	} catch {
		return undefined;
	}
}

/** The config dir Claude Code hashes into the keychain service name (and where the creds file lives). */
function configBase(): string {
	return process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
}

/**
 * The keychain service Claude Code writes its OAuth credentials under. Current Claude Code namespaces the entry
 * by an 8-char hex sha256 of the config dir, so a custom `CLAUDE_CONFIG_DIR` gets its own item; the bare
 * `KEYCHAIN_SERVICE` is the legacy/default name kept as a fallback.
 */
export function keychainService(configDir: string): string {
	const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
	return `${KEYCHAIN_SERVICE}-${hash}`;
}

function keychainBlob(service: string): string {
	try {
		const r = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
			encoding: "utf8",
			timeout: 1500,
			killSignal: "SIGKILL",
		});
		if (r.error || r.status !== 0) return "";
		return r.stdout;
	} catch {
		return "";
	}
}

/**
 * The keychain access token, read across the config-scoped service and the legacy bare service, preferring the
 * one with the latest `expiresAt`. This keeps a stale duplicate (e.g. a leftover default-profile entry) from
 * shadowing the live token Claude Code refreshes under the config-scoped name. `read` is injected for tests.
 */
export function keychainToken(
	read: (service: string) => string,
	configDir: string,
): string | undefined {
	let best: OauthToken | undefined;
	for (const service of [keychainService(configDir), KEYCHAIN_SERVICE]) {
		const parsed = parseOauth(read(service));
		if (parsed === undefined) continue;
		if (best === undefined || parsed.expiresAt > best.expiresAt) best = parsed;
	}
	return best?.accessToken;
}

/** Token order: `CLAUDE_CODE_OAUTH_TOKEN` env, else macOS keychain, else the creds file. Never throws. */
function readToken(): string | undefined {
	const env = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
	if (env !== undefined && env.trim() !== "") return env;
	const base = configBase();
	const kc = keychainToken(keychainBlob, base);
	if (kc !== undefined) return kc;
	try {
		const t = parseOauth(readFileSync(join(base, ".credentials.json"), "utf8"));
		if (t !== undefined) return t.accessToken;
	} catch {
		/* no creds file */
	}
	return undefined;
}

/** Abort a hung fetch so a stalled endpoint never keeps the detached refresh (or render) alive. */
const FETCH_TIMEOUT_MS = 3000;
/** A failed refresh frees the single-flight slot after this backoff, not the full 5-minute TTL. */
const FAIL_BACKOFF_MS = 30_000; // 30s

/**
 * Detached single-flighted refresh of the OAuth usage cache. Never blocks a render. The claim stamp only sticks
 * for the full TTL on success; any failure rolls it back to a short retry backoff.
 */
async function refresh(
	root: string,
	clock: Clock,
	fetchImpl: typeof fetch,
	version: string | undefined,
): Promise<void> {
	const now = clock.now();
	if (!singleFlight(usageStamp(root), USAGE_TTL_MS, now)) return;
	const token = readToken();
	// A missing token is a stable logged-out state (not a transient fetch failure), so keep the full-TTL claim
	// rather than backing off — this avoids a keychain read on every render tick while signed out.
	if (token === undefined) return;
	let ok = false;
	try {
		const res = await fetchImpl(ENDPOINT, {
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": `claude-code/${version ?? "unknown"}`,
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) return;
		const json: unknown = await res.json();
		const data = parseFetchedUsage(json);
		if (data === null) return;
		atomicWrite(usagePath(root), JSON.stringify({ data, fetchedAt: clock.now() }));
		ok = true;
	} finally {
		if (!ok) backoffStamp(usageStamp(root), USAGE_TTL_MS, FAIL_BACKOFF_MS, now);
	}
}

/**
 * The cached OAuth `UsageData`, read synchronously with no refresh — for the hot render path. The refresh
 * runs on the persist tail (which calls `readUsage`).
 */
export function readUsageCached(root: string): UsageData | null {
	const cached = readCachedUsage(root);
	return cached !== null ? cached.data : null;
}

/**
 * Return the cached OAuth `UsageData` synchronously (stale data is served on any fetch failure). When
 * `enabled` and the cache is missing or older than `USAGE_TTL_MS`, fire a detached single-flighted refresh —
 * never awaited, so the fetch can neither block the render nor surface an `unhandledRejection`. The
 * User-Agent version is the stdin payload's `version`. Off by default; opt in via [network].usage_fetch.
 * When enabled, sends the account's OAuth bearer token to Anthropic.
 */
export function readUsage(
	root: string,
	clock: Clock,
	opts: { enabled: boolean; version?: string; fetchImpl?: typeof fetch },
): Promise<UsageData | null> {
	const cached = readCachedUsage(root);
	const now = clock.now();
	if (opts.enabled && (cached === null || now - cached.fetchedAt > USAGE_TTL_MS)) {
		void refresh(root, clock, opts.fetchImpl ?? fetch, opts.version).catch(() => {
			/* fetch failures keep the stale cached data */
		});
	}
	return Promise.resolve(cached !== null ? cached.data : null);
}
