import { QUOTA_HIGH_PCT, QUOTA_PACE_MIN_PCT, type SignalLevel } from "../domain";

/** Context usage by raw percentage: `<34` nominal, `34–66` caution, `≥67` critical. Fixed bands. */
export function contextBand(pct: number): SignalLevel {
	if (pct < 34) return "nominal";
	if (pct <= 66) return "caution";
	return "critical";
}

/**
 * Quota usage band (block / weekly) by pace-vs-runway. Usage at or above `QUOTA_HIGH_PCT` is always
 * critical, and below `QUOTA_PACE_MIN_PCT` pace is ignored (the raw-percentage context bands apply) so trivial
 * usage early in a window can't read critical. Otherwise take the pace ratio
 * `r = used_fraction / max(elapsed_fraction, 0.01)`, where `elapsed_fraction = (now − (resets_at − windowMs)) /
 * windowMs` is how far through the window we are: `r ≤ 1` nominal (on or under pace), `1 < r ≤ 1.5` caution,
 * `r > 1.5` critical. The `0.01` floor avoids a divide-by-zero at the window start. The rule needs `resets_at`;
 * without it the band falls back to the raw-percentage context bands.
 */
export function quotaBand(
	usedPct: number,
	resetsAtMs: number | undefined,
	windowMs: number,
	nowMs: number,
): SignalLevel {
	if (usedPct >= QUOTA_HIGH_PCT) return "critical";
	if (resetsAtMs === undefined || usedPct < QUOTA_PACE_MIN_PCT) return contextBand(usedPct);
	const usedFraction = usedPct / 100;
	const elapsedFraction = Math.max((nowMs - (resetsAtMs - windowMs)) / windowMs, 0.01);
	const r = usedFraction / elapsedFraction;
	if (r <= 1) return "nominal";
	if (r <= 1.5) return "caution";
	return "critical";
}

/**
 * Whether usage is running ahead of the clock: the pace ratio `r = used_fraction / elapsed_fraction` exceeds
 * 1.5, so at this rate the window empties before it resets. Unlike `quotaBand`, this carries no absolute-fullness
 * override, so a high-but-under-pace window (e.g. 83% spent with the week nearly over) reads as on pace.
 * Needs `resets_at`; without it pace is unknowable, so returns false.
 */
export function overQuotaPace(
	usedPct: number,
	resetsAtMs: number | undefined,
	windowMs: number,
	nowMs: number,
): boolean {
	if (resetsAtMs === undefined) return false;
	const usedFraction = usedPct / 100;
	const elapsedFraction = Math.max((nowMs - (resetsAtMs - windowMs)) / windowMs, 0.01);
	return usedFraction / elapsedFraction > 1.5;
}

/** Generic ascending threshold band: `≥ critical` critical, `≥ caution` caution, else nominal. */
export function band(value: number, t: { caution: number; critical: number }): SignalLevel {
	if (value >= t.critical) return "critical";
	if (value >= t.caution) return "caution";
	return "nominal";
}
