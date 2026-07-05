import { COMPACT_URGENT_PCT, type SignalLevel } from "../domain";
import type { Payload, TranscriptScan } from "../sources";

import { contextBand } from "./signals";

export interface ContextInfo {
	readonly usedPct: number;
	readonly usedTokens: number;
	readonly windowSize: number;
	readonly band: SignalLevel;
	readonly compactions: number;
	/** Cache-read share of input-class tokens, 0–100. */
	readonly cacheHitPct: number;
	/** True once `usedPct` passes the auto-compact-imminent cutoff; trips the `compact_hint` pressure mood. */
	readonly compactPressure: boolean;
}

/**
 * Context-window usage and compactions. The band uses the fixed context cutoffs (`signals.contextBand`);
 * `cacheHitPct = cache_read / (input + cache_read + cache_creation)`; `compactPressure` trips when usage
 * passes the auto-compact-imminent cutoff.
 */
export function deriveContext(payload: Payload, scan: TranscriptScan): ContextInfo {
	const cw = payload.context_window;
	const usedPct = cw?.used_percentage ?? 0;
	const usedTokens = cw?.total_input_tokens ?? 0;
	const windowSize = cw?.context_window_size ?? 0;

	const t = scan.tokens;
	const cacheCreation = t.cache_creation_5m + t.cache_creation_1h;
	const denom = t.input + t.cache_read + cacheCreation;
	const cacheHitPct = denom > 0 ? (t.cache_read / denom) * 100 : 0;

	return {
		usedPct,
		usedTokens,
		windowSize,
		band: contextBand(usedPct),
		compactions: scan.compactions,
		cacheHitPct,
		compactPressure: usedPct > COMPACT_URGENT_PCT,
	};
}
