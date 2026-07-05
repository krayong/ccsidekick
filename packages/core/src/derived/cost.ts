import type { Session } from "../domain";
import type { BurnBucket, Clock, CostAggregate, Payload } from "../sources";

const MS_PER_HR = 3_600_000;
const MS_PER_MIN = 60_000;

export interface CostInfo {
	readonly chat: number;
	readonly project: number;
	readonly total: number;
	readonly costBurnPerHr: number;
	readonly tokenBurnPerMin: number;
	/** True only on a true first-ever scan: no payload cost and no warm-start subtotal (shows `⋯`, not $0). */
	readonly pending: boolean;
}

/**
 * Compose the cost fields from the already-scanned aggregate + burn buckets. Pure: no disk, no network, no
 * pricing (the scan + re-pricing happened in `sources/transcript`). All three cost fields are in-house token
 * pricing (globally deduped across the transcript tree, with cache discounts): Chat is the current session's
 * token-priced subtotal, Total sums that subtotal over every session with a live transcript, Project sums it
 * over the sessions sharing the current project key. Claude Code's payload `cost.total_cost_usd` double-counts
 * replayed context on resumed sessions, so it is never a Total/Project source; it (and the persisted
 * authoritative cost) is only a first-tick fallback for the current session's Chat, before the tree scan has
 * reached its transcript. Burn rates divide window cost/tokens by the time elapsed in the live window. The
 * local-currency parenthetical is applied later by `format/currency`, so no fx/currency is read here.
 */
export function deriveCost(
	tree: { readonly aggregate: CostAggregate; readonly lastScanTs: number },
	burnBuckets: readonly BurnBucket[],
	payload: Payload,
	session: Session,
	projectKey: string,
	clock: Clock,
): CostInfo {
	const agg = tree.aggregate;
	const current = String(session);
	const tokenChat = agg.tokenPriced[current];
	const payloadChat = payload.cost?.total_cost_usd;
	const authChat = agg.chat[current];
	// In-house token pricing is the source of truth. The payload cost and the persisted authoritative cost are
	// first-tick fallbacks for the current session only, before the tree scan has reached its transcript.
	const chat = tokenChat ?? payloadChat ?? authChat ?? 0;
	const pending = tokenChat === undefined && payloadChat === undefined && authChat === undefined;

	// Per-session cost is the token-priced subtotal; the current session uses the live `chat` so Chat stays
	// populated (and Total ≥ Chat) from the first tick even before the tree scan reaches its file. Only
	// sessions with a live transcript count — `tokenPriced` is rebuilt from the scanned tree each tick, so a
	// key there means the session's `.jsonl` still exists. The persisted `chat` map is never a Total/Project
	// source: a remembered payload cost for a session whose transcript is gone would otherwise inflate Total
	// forever, and it double-counts replayed context regardless.
	const sessions = new Set<string>([...Object.keys(agg.tokenPriced), current]);
	let total = 0;
	let projectCost = 0;
	for (const s of sessions) {
		const eff = s === current ? chat : (agg.tokenPriced[s] ?? 0);
		total += eff;
		const key = s === current ? projectKey : agg.sessionProject[s];
		if (key === projectKey) projectCost += eff;
	}

	const now = clock.now();
	let windowCost = 0;
	let windowTokens = 0;
	let earliest = Number.POSITIVE_INFINITY;
	for (const b of burnBuckets) {
		windowCost += b.costUsd;
		windowTokens += b.tokens;
		if (b.ts < earliest) earliest = b.ts;
	}
	const elapsedMs = Number.isFinite(earliest) ? now - earliest : 0;
	const elapsedHr = elapsedMs / MS_PER_HR;
	const elapsedMin = elapsedMs / MS_PER_MIN;

	return {
		chat,
		project: projectCost,
		total,
		costBurnPerHr: elapsedHr > 0 ? windowCost / elapsedHr : 0,
		tokenBurnPerMin: elapsedMin > 0 ? windowTokens / elapsedMin : 0,
		pending,
	};
}
