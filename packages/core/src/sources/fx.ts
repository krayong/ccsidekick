import { join } from "node:path";

import fxFallback from "../data/fx-fallback.json";
import { FX_TTL_MS } from "../domain";

import type { Clock } from "./clock";
import { atomicWrite, backoffStamp, cacheDir, readJson, singleFlight } from "./storage";

/** USD→code conversion rates. */
export type RateTable = Record<string, number>;

const FALLBACK: RateTable = fxFallback;
const ENDPOINT = "https://open.er-api.com/v6/latest/USD";

interface FxCache {
	readonly rates: RateTable;
	readonly fetchedAt: number;
	readonly nextUpdateAt: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asNumber = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Lenient rate coercion: drop any non-finite-positive entry; null when nothing usable remains. */
function coerceRates(v: unknown): RateTable | null {
	if (!isObject(v)) return null;
	const out: RateTable = {};
	for (const [code, rate] of Object.entries(v)) {
		const n = asNumber(rate);
		if (n !== undefined && n > 0) out[code] = n;
	}
	return Object.keys(out).length > 0 ? out : null;
}

const fxPath = (root: string): string => join(cacheDir(root), "fx.json");
const fxStamp = (root: string): string => join(cacheDir(root), "fx.stamp");

/** Shape-validate the cached table; `readJson` only catches parse errors, so re-coerce every field. */
function readCachedFx(root: string): FxCache | null {
	const raw = readJson<unknown>(fxPath(root), undefined);
	if (!isObject(raw)) return null;
	const rates = coerceRates(raw["rates"]);
	const fetchedAt = asNumber(raw["fetchedAt"]);
	const nextUpdateAt = asNumber(raw["nextUpdateAt"]);
	if (rates === null || fetchedAt === undefined || nextUpdateAt === undefined) return null;
	return { rates, fetchedAt, nextUpdateAt };
}

/**
 * The endpoint's next-update time in epoch-ms. Prefer numeric `time_next_update_unix` (epoch-**seconds**, so
 * ×1000), else fall back to `Date.parse(time_next_update_utc)` (the documented RFC-1123 string, already ms).
 */
function endpointNextMs(json: Record<string, unknown>): number | undefined {
	const unix = asNumber(json["time_next_update_unix"]);
	if (unix !== undefined) return unix * 1000;
	const utc = json["time_next_update_utc"];
	if (typeof utc === "string") {
		const parsed = Date.parse(utc);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

/** Abort a hung fetch so a stalled endpoint never keeps the detached refresh (or render) alive. */
const FETCH_TIMEOUT_MS = 3000;
/** A failed refresh frees the single-flight slot after this backoff, not the full 7-day TTL. */
const FAIL_BACKOFF_MS = 300_000; // 5 min

/**
 * Detached weekly refresh; single-flighted, validates rates, atomic-writes the cache. Never blocks a render. The
 * claim stamp only sticks for the full TTL on success; any failure rolls it back to a short retry backoff.
 */
async function refresh(root: string, clock: Clock, fetchImpl: typeof fetch): Promise<void> {
	const now = clock.now();
	if (!singleFlight(fxStamp(root), FX_TTL_MS, now)) return;
	let ok = false;
	try {
		const res = await fetchImpl(ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) return;
		const json: unknown = await res.json();
		if (!isObject(json)) return;
		const rates = coerceRates(json["rates"]);
		if (rates === null) return;
		const fetchedAt = clock.now();
		const floor = fetchedAt + FX_TTL_MS;
		const endpoint = endpointNextMs(json);
		const nextUpdateAt = endpoint !== undefined ? Math.max(endpoint, floor) : floor;
		atomicWrite(fxPath(root), JSON.stringify({ rates, fetchedAt, nextUpdateAt }));
		ok = true;
	} finally {
		if (!ok) backoffStamp(fxStamp(root), FX_TTL_MS, FAIL_BACKOFF_MS, now);
	}
}

/**
 * The bundled fallback table merged over `cache/fx.json`, read synchronously with no refresh. The hot render
 * path needs the rate now and leaves the weekly refresh to the persist tail (which calls `readFx`).
 */
export function readFxCached(root: string): RateTable {
	const cached = readCachedFx(root);
	return cached !== null ? { ...FALLBACK, ...cached.rates } : { ...FALLBACK };
}

/**
 * Return the bundled fallback table merged over `cache/fx.json`, synchronously. When `enabled` and the cached
 * `nextUpdateAt` has passed (a 7-day `FX_TTL_MS` floor), fire a detached single-flighted refresh — never
 * awaited, so the fetch can neither block the render nor surface an `unhandledRejection`.
 */
export function readFx(
	root: string,
	clock: Clock,
	opts: { enabled: boolean; fetchImpl?: typeof fetch },
): Promise<RateTable> {
	const cached = readCachedFx(root);
	const table: RateTable = cached !== null ? { ...FALLBACK, ...cached.rates } : { ...FALLBACK };
	if (opts.enabled && (cached === null || clock.now() >= cached.nextUpdateAt)) {
		void refresh(root, clock, opts.fetchImpl ?? fetch).catch(() => {
			/* fetch failures keep the cached/bundled table */
		});
	}
	return Promise.resolve(table);
}
