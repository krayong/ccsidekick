import { expect, test } from "bun:test";

import { asSession } from "../domain";
import { type BurnBucket, type CostAggregate, type Payload, fixedClock } from "../sources";

import { deriveCost } from "./cost";

const base: Payload = { workspace: {}, model: {} };
const NOW = 1_000_000_000_000;
const clock = fixedClock(NOW);
const S = asSession("sess-1");
const PROJ = "/home/me/repo";

const tree = (aggregate: CostAggregate): { aggregate: CostAggregate; lastScanTs: number } => ({
	aggregate,
	lastScanTs: NOW,
});

const agg = (over: Partial<CostAggregate>): CostAggregate => ({
	chat: {},
	tokenPriced: {},
	sessionProject: {},
	byModel: {},
	...over,
});

test("chat prefers the token-priced subtotal, else the payload cost, else authoritative", () => {
	const withPayload: Payload = { ...base, cost: { total_cost_usd: 1.23 } };
	// token-priced present ⇒ used even when a live payload cost exists
	const tokenAndPayload = tree(agg({ tokenPriced: { "sess-1": 4.4 } }));
	expect(deriveCost(tokenAndPayload, [], withPayload, S, PROJ, clock).chat).toBe(4.4);
	// no token-priced ⇒ live payload cost (first-tick fallback)
	const payloadOnly = tree(agg({}));
	expect(deriveCost(payloadOnly, [], withPayload, S, PROJ, clock).chat).toBe(1.23);
	// no token-priced, no payload ⇒ persisted authoritative cost
	const authOnly = tree(agg({ chat: { "sess-1": 9.99 } }));
	expect(deriveCost(authOnly, [], base, S, PROJ, clock).chat).toBe(9.99);
});

test("pending only when neither payload cost, authoritative, nor a token-priced subtotal exists", () => {
	const empty = tree(agg({}));
	expect(deriveCost(empty, [], base, S, PROJ, clock).pending).toBe(true);

	const warm = tree(agg({ tokenPriced: { "sess-1": 0.5 } }));
	expect(deriveCost(warm, [], base, S, PROJ, clock).pending).toBe(false);

	const paid: Payload = { ...base, cost: { total_cost_usd: 0 } };
	expect(deriveCost(empty, [], paid, S, PROJ, clock).pending).toBe(false);
});

test("Project cost is non-zero when the path-keyed aggregate holds cost for the current project", () => {
	// A different (non-current) session priced under the current project's path key.
	const t = tree(
		agg({
			tokenPriced: { "sess-other": 4.5 },
			sessionProject: { "sess-other": PROJ },
		}),
	);
	const c = deriveCost(t, [], base, S, PROJ, clock);
	expect(c.project).toBe(4.5);
});

test("Total sums the token-priced subtotals across sessions, ignoring the payload cost", () => {
	// The live payload reports $233 for the current session, but in-house pricing is the source of truth: the
	// current session's token-priced subtotal is $120, so it — not the payload — feeds Chat and Total.
	const high: Payload = { ...base, cost: { total_cost_usd: 233.59 } };
	const t = tree(
		agg({
			tokenPriced: { "sess-1": 120, "sess-2": 3.95 },
			sessionProject: { "sess-1": PROJ, "sess-2": "/elsewhere" },
		}),
	);
	const c = deriveCost(t, [], high, S, PROJ, clock);
	expect(c.chat).toBe(120);
	expect(c.total).toBeCloseTo(120 + 3.95, 9);
	expect(c.total).toBeGreaterThanOrEqual(c.chat);
});

test("the payload cost is a first-tick fallback for the current session before its transcript is scanned", () => {
	// The current session has no token-priced subtotal yet (its file isn't in the freshly-scanned tree), so
	// the live payload cost stands in for its contribution to Chat and Total.
	const high: Payload = { ...base, cost: { total_cost_usd: 233.59 } };
	const t = tree(
		agg({ tokenPriced: { "sess-2": 3.95 }, sessionProject: { "sess-2": "/elsewhere" } }),
	);
	const c = deriveCost(t, [], high, S, PROJ, clock);
	expect(c.chat).toBe(233.59);
	expect(c.total).toBeCloseTo(233.59 + 3.95, 9);
});

test("Total ≥ Project, and Project includes the current session's token-priced cost", () => {
	const t = tree(
		agg({
			tokenPriced: { "sess-1": 8, "sess-3": 5 },
			sessionProject: { "sess-1": PROJ, "sess-3": "/other" },
		}),
	);
	const c = deriveCost(t, [], base, S, PROJ, clock);
	expect(c.project).toBe(8); // current session, attributed to its project
	expect(c.total).toBe(13); // 8 + other-project session (5)
	expect(c.total).toBeGreaterThanOrEqual(c.project);
});

test("a session present only in the persisted chat map never enters Total", () => {
	// `chat` is persisted across ticks; `tokenPriced` is rebuilt from the scanned tree each tick. A session
	// present only in `chat` has no surviving transcript (deleted / GC'd / a throwaway test run) and is never
	// a Total source — Total sums token-priced subtotals only.
	const t = tree(
		agg({
			chat: { "ghost-session": 250 },
			tokenPriced: { "sess-1": 8, "sess-3": 5 },
			sessionProject: { "sess-1": PROJ, "sess-3": "/other" },
		}),
	);
	const c = deriveCost(t, [], base, S, PROJ, clock);
	// sess-1 (current, token-priced 8) + sess-3 (token-priced 5); the $250 chat-only ghost is dropped.
	expect(c.total).toBe(13);
	expect(c.project).toBe(8);
});

test("burn rates divide window cost/tokens by the time elapsed in the window", () => {
	const buckets: BurnBucket[] = [
		{ ts: NOW - 2 * 3_600_000, tokens: 6000, costUsd: 4 },
		{ ts: NOW - 1 * 3_600_000, tokens: 6000, costUsd: 2 },
	];
	const c = deriveCost(tree(agg({})), buckets, base, S, PROJ, clock);
	expect(c.costBurnPerHr).toBeCloseTo(3, 9);
	expect(c.tokenBurnPerMin).toBeCloseTo(100, 9);
});

test("a single burn bucket divides its cost by its own elapsed hours", () => {
	const ts = NOW - 90 * 60_000; // 1.5h ago ⇒ elapsed window is 1.5h
	const bucket: BurnBucket = { ts, tokens: 3000, costUsd: 6 };
	const elapsedHr = (NOW - ts) / 3_600_000;
	const c = deriveCost(tree(agg({})), [bucket], base, S, PROJ, clock);
	expect(c.costBurnPerHr).toBeCloseTo(6 / elapsedHr, 9); // 6 / 1.5 = 4
});

test("no buckets ⇒ zero burn rates (no divide-by-zero)", () => {
	const c = deriveCost(tree(agg({})), [], base, S, PROJ, clock);
	expect(c.costBurnPerHr).toBe(0);
	expect(c.tokenBurnPerMin).toBe(0);
});
