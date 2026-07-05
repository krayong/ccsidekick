import { expect, test } from "bun:test";

import { asProject, asSession } from "../domain";
import {
	type AttributionEntry,
	type AttributionStore,
	type CostCache,
	type CostFileEntry,
	fixedClock,
} from "../sources";

import { buildDaily, buildModels, deriveAllMetrics, deriveFamiliarity } from "./analytics";

const DAY = 86_400_000;
const TODAY = 20_000; // day ordinal
const NOW = TODAY * DAY + 12 * 3_600_000; // midday today
const clock = fixedClock(NOW, "UTC");

const ZERO_TOKENS: CostFileEntry["record"]["tokens"] = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_creation: 0,
};

interface Rec {
	readonly session: string;
	readonly project: string;
	readonly day: number;
}

function buildCache(recs: readonly Rec[]): CostCache {
	const files: Record<string, CostFileEntry> = {};
	recs.forEach((r, i) => {
		const start = r.day * DAY + 3_600_000;
		files[`f${i}`] = {
			mtime: 0,
			size: 0,
			total: 0,
			lines: [],
			models: [],
			projectPath: r.project,
			record: {
				session: asSession(r.session),
				project: asProject(r.project),
				start,
				end: start + 600_000,
				tokens: ZERO_TOKENS,
				messages: 0,
			},
		};
	});
	return {
		files,
		aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
		lastScanTs: NOW,
	};
}

function attribution(map: Record<string, AttributionEntry>): AttributionStore {
	return map;
}

const REPO = asProject("owner/repo");

const tierAt = (count: number, character = "batman"): string => {
	const recs: Rec[] = [];
	const attr: Record<string, AttributionEntry> = {};
	for (let i = 0; i < count; i++) {
		recs.push({ session: `s${i}`, project: "owner/repo", day: TODAY - i });
		attr[`s${i}`] = { project: "owner/repo", character };
	}
	return deriveFamiliarity(attribution(attr), "batman", buildCache(recs), REPO, clock).tier;
};

const attr = (sessions: string[]): Record<string, AttributionEntry> =>
	Object.fromEntries(sessions.map((s) => [s, { project: "owner/repo", character: "batman" }]));

test("tier boundaries at 3 / 15 / 50 / 100 count only the active character's sessions", () => {
	expect(tierAt(2)).toBe("stranger");
	expect(tierAt(3)).toBe("acquaintance");
	expect(tierAt(14)).toBe("acquaintance");
	expect(tierAt(15)).toBe("friend");
	expect(tierAt(49)).toBe("friend");
	expect(tierAt(50)).toBe("partner");
	expect(tierAt(99)).toBe("partner");
	expect(tierAt(100)).toBe("legend");
});

test("a second character's sessions do not raise this character's tier", () => {
	const recs: Rec[] = [];
	const attr: Record<string, AttributionEntry> = {};
	for (let i = 0; i < 20; i++) {
		recs.push({ session: `s${i}`, project: "owner/repo", day: TODAY - i });
		attr[`s${i}`] = { project: "owner/repo", character: "joker" };
	}
	// two batman sessions among twenty joker sessions ⇒ batman is still a stranger
	recs.push({ session: "b1", project: "owner/repo", day: TODAY });
	recs.push({ session: "b2", project: "owner/repo", day: TODAY - 1 });
	attr["b1"] = { project: "owner/repo", character: "batman" };
	attr["b2"] = { project: "owner/repo", character: "batman" };
	const fam = deriveFamiliarity(attribution(attr), "batman", buildCache(recs), REPO, clock);
	expect(fam.sessionCount).toBe(2);
	expect(fam.tier).toBe("stranger");
});

test("seenProject is global across characters (first contact)", () => {
	const recs: Rec[] = [{ session: "s0", project: "owner/repo", day: TODAY }];
	const attr = { s0: { project: "owner/repo", character: "joker" } };
	// batman has never worked owner/repo, but joker has ⇒ not first contact
	expect(deriveFamiliarity(attr, "batman", buildCache(recs), REPO, clock).seenProject).toBe(true);
	// an unseen project ⇒ first contact
	expect(
		deriveFamiliarity(attr, "batman", buildCache(recs), asProject("other/repo"), clock)
			.seenProject,
	).toBe(false);
});

test("current streak survives a one-day grace gap and breaks on a two-day gap", () => {
	// active today and two days ago (one-day gap) ⇒ streak survives, counts both ⇒ 2
	const grace = [
		{ session: "a", project: "owner/repo", day: TODAY },
		{ session: "b", project: "owner/repo", day: TODAY - 2 },
	];
	expect(
		deriveFamiliarity(attr(["a", "b"]), "batman", buildCache(grace), REPO, clock)
			.currentStreakDays,
	).toBe(2);

	// active today and three days ago (two-day gap) ⇒ the older day is cut off ⇒ 1
	const broken = [
		{ session: "a", project: "owner/repo", day: TODAY },
		{ session: "b", project: "owner/repo", day: TODAY - 3 },
	];
	expect(
		deriveFamiliarity(attr(["a", "b"]), "batman", buildCache(broken), REPO, clock)
			.currentStreakDays,
	).toBe(1);

	// no recent activity ⇒ fully broken ⇒ 0
	const cold = [{ session: "a", project: "owner/repo", day: TODAY - 10 }];
	expect(
		deriveFamiliarity(attr(["a"]), "batman", buildCache(cold), REPO, clock).currentStreakDays,
	).toBe(0);
});

test('a session with no attribution attributes to "unknown"', () => {
	const recs: Rec[] = [{ session: "s0", project: "owner/repo", day: TODAY }];
	// empty attribution store ⇒ the record joins to character "unknown"
	expect(deriveFamiliarity({}, "unknown", buildCache(recs), REPO, clock).sessionCount).toBe(1);
	expect(deriveFamiliarity({}, "batman", buildCache(recs), REPO, clock).sessionCount).toBe(0);
});

test('the "default" session is never counted', () => {
	const recs: Rec[] = [
		{ session: "default", project: "owner/repo", day: TODAY },
		{ session: "s1", project: "owner/repo", day: TODAY },
	];
	const attr = {
		default: { project: "owner/repo", character: "batman" },
		s1: { project: "owner/repo", character: "batman" },
	};
	expect(deriveFamiliarity(attr, "batman", buildCache(recs), REPO, clock).sessionCount).toBe(1);
});

test("daysSinceLastSession is ∞ with no sessions and the working-since start is reported", () => {
	const fam = deriveFamiliarity({}, "batman", buildCache([]), REPO, clock);
	expect(fam.daysSinceLastSession).toBe(Number.POSITIVE_INFINITY);
	expect(fam.workingSinceMs).toBe(0);

	const recs: Rec[] = [{ session: "s0", project: "owner/repo", day: TODAY - 5 }];
	const attr = { s0: { project: "owner/repo", character: "batman" } };
	const fam2 = deriveFamiliarity(attr, "batman", buildCache(recs), REPO, clock);
	expect(fam2.daysSinceLastSession).toBe(5);
	expect(fam2.workingSinceMs).toBe((TODAY - 5) * DAY + 3_600_000);
});

test("buildModels merges provider id variants, ranks by cost, and computes cost share", () => {
	const models = buildModels({
		"claude-opus-4-8": { cost: 6, tokens: 100 },
		"anthropic.claude-opus-4-8-v1:0": { cost: 2, tokens: 50 }, // folds into claude-opus-4-8
		"claude-sonnet-5": { cost: 2, tokens: 300 },
	});
	expect(models.map((m) => m.key)).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
	expect(models[0]).toMatchObject({ key: "claude-opus-4-8", costUsd: 8, tokens: 150 });
	expect(models[0]?.share).toBeCloseTo(0.8, 9); // 8 of 10 total
	expect(models[1]?.share).toBeCloseTo(0.2, 9);
});

test("buildModels on an empty map yields no rows and never divides by zero", () => {
	expect(buildModels({})).toEqual([]);
});

// ── deriveAllMetrics (the full TUI catalog) ────────────────────────────────────

const START_OFFSET = 3_600_000; // record starts at +1h of its calendar day
const DURATION = 600_000;

interface FullRec {
	readonly session: string;
	readonly project: string;
	readonly day: number; // day ordinal
	readonly character: string | null; // null ⇒ no attribution (joins to "unknown")
	readonly cost: number;
}

function buildFull(recs: readonly FullRec[]): { cache: CostCache; attr: AttributionStore } {
	const files: Record<string, CostFileEntry> = {};
	const attr: Record<string, AttributionEntry> = {};
	const tokenPriced: Record<string, number> = {};
	recs.forEach((r, i) => {
		const start = r.day * DAY + START_OFFSET;
		files[`f${i}`] = {
			mtime: 0,
			size: 0,
			total: r.cost,
			lines: [{ id: `L${i}`, sidechain: false, ts: start, cost: r.cost }],
			models: [],
			projectPath: r.project,
			record: {
				session: asSession(r.session),
				project: asProject(r.project),
				start,
				end: start + DURATION,
				tokens: ZERO_TOKENS,
				messages: 1,
			},
		};
		if (r.character !== null) attr[r.session] = { project: r.project, character: r.character };
		// One file per session in these fixtures ⇒ deduped subtotal equals the per-file total.
		if (r.session !== "default")
			tokenPriced[r.session] = (tokenPriced[r.session] ?? 0) + r.cost;
	});
	return {
		cache: {
			files,
			aggregate: { chat: {}, tokenPriced, sessionProject: {}, byModel: {} },
			lastScanTs: NOW,
		},
		attr,
	};
}

test("buildDaily buckets records into a zero-filled trailing window, oldest first", () => {
	const recs = [
		{ day: 100, cost: 1 },
		{ day: 100, cost: 2 },
		{ day: 98, cost: 0.5 },
	];
	expect(buildDaily(recs, 100, 3)).toEqual([
		{ day: 98, sessions: 1, costUsd: 0.5 },
		{ day: 99, sessions: 0, costUsd: 0 },
		{ day: 100, sessions: 2, costUsd: 3 },
	]);
});

test("deriveAllMetrics reduces crafted records: windows, all-time metrics, favorite, cost join", () => {
	// batman: 4 sessions (one all-time-only at TODAY-100); joker: 2 (one all-time-only at TODAY-50);
	// unknown: 5 recent sessions. Recent window is 30 days (cutoff needs day ≥ TODAY-29).
	const recs: FullRec[] = [
		{ session: "b1", project: "owner/repo", day: TODAY, character: "batman", cost: 2 },
		{ session: "b2", project: "owner/repo", day: TODAY - 1, character: "batman", cost: 3 },
		{ session: "b3", project: "owner/repo", day: TODAY - 2, character: "batman", cost: 1 },
		{ session: "b4", project: "owner/repo", day: TODAY - 100, character: "batman", cost: 5 },
		{ session: "j1", project: "owner/repo", day: TODAY - 1, character: "joker", cost: 0.5 },
		{ session: "j2", project: "owner/repo", day: TODAY - 50, character: "joker", cost: 0.5 },
		{ session: "u1", project: "owner/repo", day: TODAY, character: null, cost: 10 },
		{ session: "u2", project: "owner/repo", day: TODAY - 1, character: null, cost: 10 },
		{ session: "u3", project: "owner/repo", day: TODAY - 2, character: null, cost: 10 },
		{ session: "u4", project: "owner/repo", day: TODAY - 3, character: null, cost: 10 },
		{ session: "u5", project: "owner/repo", day: TODAY - 4, character: null, cost: 10 },
	];
	const { cache, attr } = buildFull(recs);
	const m = deriveAllMetrics(attr, cache, clock);

	// Recent-window vs all-time split: 11 sessions all-time, 9 within the 30-day window (b4 + j2 excluded).
	expect(m.overall.allTime.sessionCount).toBe(11);
	expect(m.overall.recent.sessionCount).toBe(9);

	// Working Since (all-time): the earliest start across every record — batman's TODAY-100 session.
	const expectedWorkingSince = (TODAY - 100) * DAY + START_OFFSET;
	expect(m.overall.allTime.workingSinceMs).toBe(expectedWorkingSince);
	// …and Working Since is window-independent: the recent group reports the same all-time start.
	expect(m.overall.recent.workingSinceMs).toBe(expectedWorkingSince);

	// Longest Streak (all-time): days TODAY-4…TODAY form a 5-day consecutive run.
	expect(m.overall.allTime.longestStreakDays).toBe(5);

	// favoriteCharacter excludes "unknown": unknown has the most sessions (5) but is dropped, so batman (4) wins.
	expect(m.overall.allTime.favoriteCharacter).toEqual({ character: "batman", sessions: 4 });

	// Cost is joined per-session: overall sums every entry's `total`.
	expect(m.overall.allTime.totalCostUsd).toBeCloseTo(2 + 3 + 1 + 5 + 0.5 + 0.5 + 50, 6);

	// Per-character cost join: batman's all-time entry sums only batman's four sessions.
	const batman = m.characters.find((c) => c.key === "batman");
	expect(batman?.allTime.sessionCount).toBe(4);
	expect(batman?.allTime.totalCostUsd).toBeCloseTo(11, 6);
	expect(batman?.recent.sessionCount).toBe(3); // the TODAY-100 session is outside the window

	expect(m.daily).toHaveLength(60);
	expect(m.daily.at(-1)?.day).toBe(TODAY);
});
