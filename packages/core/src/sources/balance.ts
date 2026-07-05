import { BALANCE_FRESHNESS_MS } from "../domain";

import type { Clock } from "./clock";
import { readJson } from "./storage";

/** An external prepaid-balance snapshot, read from `[network].balance_path`. */
export interface BalanceSnapshot {
	readonly amount: number;
	readonly currency: string;
	readonly ts: number;
}

/**
 * Read the balance snapshot at `path`; returns `null` when the path is unset, missing, wrong-shaped, or older
 * than `BALANCE_FRESHNESS_MS` (a hardcoded freshness floor, not config). Never throws.
 */
export function readBalance(path: string, clock: Clock): BalanceSnapshot | null {
	if (path === "") return null;
	const raw = readJson<unknown>(path, undefined);
	if (typeof raw !== "object" || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const amount = r["amount"];
	const currency = r["currency"];
	const ts = r["ts"];
	if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
	if (typeof currency !== "string") return null;
	if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
	if (clock.now() - ts > BALANCE_FRESHNESS_MS) return null;
	return { amount, currency, ts };
}
