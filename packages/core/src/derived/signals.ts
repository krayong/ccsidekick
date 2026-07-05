import type { SignalLevel } from "../domain";

/** Quota critical floor: usage at or above this percent reads critical regardless of pace. */
export const QUOTA_CRITICAL_PCT = 80;

/** Context usage by raw percentage: `<34` nominal, `34–66` caution, `≥67` critical. Fixed bands. */
export function contextBand(pct: number): SignalLevel {
	if (pct < 34) return "nominal";
	if (pct <= 66) return "caution";
	return "critical";
}

/**
 * Quota usage band (block / weekly) by pace-vs-runway. Usage at or above `QUOTA_CRITICAL_PCT` is always
 * critical. Otherwise take the pace ratio `r = used_fraction / max(elapsed_fraction, 0.01)`, where
 * `elapsed_fraction = (now − (resets_at − windowMs)) / windowMs` is how far through the window we are: `r ≤ 1`
 * nominal (on or under pace), `1 < r ≤ 1.5` caution, `r > 1.5` critical. The `0.01` floor avoids a
 * divide-by-zero at the window start. The rule needs `resets_at`; without it the band falls back to the
 * raw-percentage context bands.
 */
export function quotaBand(
	usedPct: number,
	resetsAtMs: number | undefined,
	windowMs: number,
	nowMs: number,
): SignalLevel {
	if (usedPct >= QUOTA_CRITICAL_PCT) return "critical";
	if (resetsAtMs === undefined) return contextBand(usedPct);
	const usedFraction = usedPct / 100;
	const elapsedFraction = Math.max((nowMs - (resetsAtMs - windowMs)) / windowMs, 0.01);
	const r = usedFraction / elapsedFraction;
	if (r <= 1) return "nominal";
	if (r <= 1.5) return "caution";
	return "critical";
}

/** Generic ascending threshold band: `≥ critical` critical, `≥ caution` caution, else nominal. */
export function band(value: number, t: { caution: number; critical: number }): SignalLevel {
	if (value >= t.critical) return "critical";
	if (value >= t.caution) return "caution";
	return "nominal";
}
