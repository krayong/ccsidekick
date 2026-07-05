import { expect, test } from "bun:test";

import { asProject, asSession } from "../domain";
import {
	type AttributionEntry,
	type AttributionStore,
	type CostCache,
	type CostFileEntry,
	fixedClock,
} from "../sources";

type TokenSums = CostFileEntry["record"]["tokens"];
import { deriveAllMetrics } from "./analytics";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TODAY = 20_000; // day ordinal
const NOW = TODAY * DAY + 12 * HOUR; // midday today (UTC)
const clock = fixedClock(NOW, "UTC");

const ZERO_TOKENS: TokenSums = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };

interface Rec {
	readonly session: string;
	readonly project: string;
	readonly character: string;
	readonly day: number;
	readonly startHour?: number;
	readonly durationMs?: number;
	readonly cost?: number;
	readonly tokens?: TokenSums;
}

function build(recs: readonly Rec[]): { cache: CostCache; attribution: AttributionStore } {
	const files: Record<string, CostFileEntry> = {};
	const attribution: Record<string, AttributionEntry> = {};
	const tokenPriced: Record<string, number> = {};
	recs.forEach((r, i) => {
		const start = r.day * DAY + (r.startHour ?? 1) * HOUR;
		const end = start + (r.durationMs ?? 600_000);
		files[`f${i}`] = {
			mtime: 0,
			size: 0,
			total: r.cost ?? 0,
			lines: [{ id: `L${i}`, sidechain: false, ts: start, cost: r.cost ?? 0 }],
			models: [],
			projectPath: r.project,
			record: {
				session: asSession(r.session),
				project: asProject(r.project),
				start,
				end,
				tokens: r.tokens ?? ZERO_TOKENS,
				messages: 0,
			},
		};
		attribution[r.session] = { project: r.project, character: r.character };
		// One file per session in these fixtures ⇒ deduped subtotal equals the per-file total.
		if (r.session !== "default")
			tokenPriced[r.session] = (tokenPriced[r.session] ?? 0) + (r.cost ?? 0);
	});
	return {
		cache: {
			files,
			aggregate: { chat: {}, tokenPriced, sessionProject: {}, byModel: {} },
			lastScanTs: NOW,
		},
		attribution,
	};
}

test("overall session count, active days, total time, and total cost", () => {
	const { cache, attribution } = build([
		{
			session: "a",
			project: "owner/repo",
			character: "batman",
			day: TODAY,
			durationMs: 10 * 60_000,
			cost: 1.5,
		},
		{
			session: "b",
			project: "owner/repo",
			character: "robin",
			day: TODAY - 1,
			durationMs: 20 * 60_000,
			cost: 2.5,
		},
		{
			session: "c",
			project: "owner/two",
			character: "batman",
			day: TODAY - 1,
			durationMs: 30 * 60_000,
			cost: 6,
		},
	]);
	const m = deriveAllMetrics(attribution, cache, clock).overall.allTime;
	expect(m.sessionCount).toBe(3);
	expect(m.activeDays).toBe(2);
	expect(m.totalTimeMs).toBe(60 * 60_000);
	expect(m.totalCostUsd).toBe(10);
	expect(m.maxDurationMs).toBe(30 * 60_000);
	expect(m.maxDurationOwner).toBe("c");
	expect(m.medianDurationMs).toBe(20 * 60_000);
});

test("a session's many files collapse to one record: deduped cost, no session-count inflation", () => {
	// One session, three files: the main transcript plus two Task sub-agent files (which share the parent
	// `sessionId`). Each file's per-file `total` re-prices overlapping history (8 + 6 + 4 = 18), but the
	// dedup-correct cost lives in `tokenPriced` (10), and the session must count once — not three times.
	const start = TODAY * DAY + HOUR;
	const file = (key: string, total: number): CostFileEntry => ({
		mtime: 0,
		size: 0,
		total,
		lines: [{ id: key, sidechain: false, ts: start, cost: total }],
		models: [],
		projectPath: "owner/repo",
		record: {
			session: asSession("s"),
			project: asProject("owner/repo"),
			start,
			end: start + 600_000,
			tokens: ZERO_TOKENS,
			messages: 0,
		},
	});
	const cache: CostCache = {
		files: { f0: file("L0", 8), sub0: file("L1", 6), sub1: file("L2", 4) },
		aggregate: { chat: {}, tokenPriced: { s: 10 }, sessionProject: {}, byModel: {} },
		lastScanTs: NOW,
	};
	const attribution: AttributionStore = { s: { project: "owner/repo", character: "batman" } };
	const m = deriveAllMetrics(attribution, cache, clock).overall.allTime;
	expect(m.totalCostUsd).toBeCloseTo(10, 9); // deduped, not 8 + 6 + 4 = 18
	expect(m.sessionCount).toBe(1); // one session, not three files
});

test("the 'default' session is excluded from the aggregate", () => {
	const { cache, attribution } = build([
		{ session: "default", project: "owner/repo", character: "batman", day: TODAY },
		{ session: "real", project: "owner/repo", character: "batman", day: TODAY },
	]);
	expect(deriveAllMetrics(attribution, cache, clock).overall.allTime.sessionCount).toBe(1);
});

test("recent window drops records older than 30 days; all-time keeps them", () => {
	const { cache, attribution } = build([
		{ session: "old", project: "owner/repo", character: "batman", day: TODAY - 40 },
		{ session: "new", project: "owner/repo", character: "batman", day: TODAY - 2 },
	]);
	const m = deriveAllMetrics(attribution, cache, clock);
	expect(m.overall.allTime.sessionCount).toBe(2);
	expect(m.overall.recent.sessionCount).toBe(1);
});

test("working since, longest streak, and longest gap stay all-time under the recent window", () => {
	const { cache, attribution } = build([
		{ session: "s0", project: "owner/repo", character: "batman", day: TODAY - 100 },
		{ session: "s1", project: "owner/repo", character: "batman", day: TODAY - 2 },
		{ session: "s2", project: "owner/repo", character: "batman", day: TODAY - 1 },
		{ session: "s3", project: "owner/repo", character: "batman", day: TODAY },
	]);
	const recent = deriveAllMetrics(attribution, cache, clock).overall.recent;
	expect(recent.workingSinceMs).toBe((TODAY - 100) * DAY + HOUR);
	expect(recent.longestStreakDays).toBe(3); // the 3 consecutive recent days
	expect(recent.longestGapMs).toBeGreaterThan(90 * DAY);
});

test("current streak counts consecutive days back from today with one grace day", () => {
	const { cache, attribution } = build([
		{ session: "s0", project: "p", character: "batman", day: TODAY },
		{ session: "s1", project: "p", character: "batman", day: TODAY - 1 },
		// gap at TODAY-2 (survives via grace)
		{ session: "s2", project: "p", character: "batman", day: TODAY - 3 },
	]);
	expect(deriveAllMetrics(attribution, cache, clock).overall.allTime.currentStreakDays).toBe(3);
});

test("most expensive is the project with the largest summed cost", () => {
	const { cache, attribution } = build([
		{ session: "a", project: "owner/cheap", character: "batman", day: TODAY, cost: 1 },
		{ session: "b", project: "owner/pricey", character: "batman", day: TODAY, cost: 5 },
		{ session: "c", project: "owner/pricey", character: "batman", day: TODAY, cost: 5 },
	]);
	const m = deriveAllMetrics(attribution, cache, clock).overall.allTime;
	expect(m.mostExpensive?.key).toBe("owner/pricey");
	expect(m.mostExpensive?.costUsd).toBe(10);
});

test("favorite character is the one with the most sessions and excludes unknown", () => {
	const { cache, attribution } = build([
		{ session: "a", project: "p", character: "batman", day: TODAY },
		{ session: "b", project: "p", character: "batman", day: TODAY },
		{ session: "c", project: "p", character: "robin", day: TODAY },
	]);
	expect(deriveAllMetrics(attribution, cache, clock).overall.allTime.favoriteCharacter).toEqual({
		character: "batman",
		sessions: 2,
	});
});

test("peak hour and busiest weekday come from the start histograms", () => {
	const { cache, attribution } = build([
		{ session: "a", project: "p", character: "batman", day: TODAY, startHour: 22 },
		{ session: "b", project: "p", character: "batman", day: TODAY, startHour: 22 },
		{ session: "c", project: "p", character: "batman", day: TODAY - 1, startHour: 9 },
	]);
	const m = deriveAllMetrics(attribution, cache, clock).overall.allTime;
	expect(m.peakHour).toBe(22);
	// ordinal 20000 → weekday (20000+4)%7 = 5 (Friday)
	expect(m.busiestWeekday).toBe(5);
});

test("weekday vs weekend buckets split by the day's weekday", () => {
	// ordinal 20001 = Sat (weekend); 20000 = Fri (weekday)
	const { cache, attribution } = build([
		{
			session: "sat",
			project: "p",
			character: "batman",
			day: 20_001,
			durationMs: 60_000,
			cost: 1,
		},
		{
			session: "fri",
			project: "p",
			character: "batman",
			day: 20_000,
			durationMs: 120_000,
			cost: 2,
		},
	]);
	const m = deriveAllMetrics(attribution, cache, clock).overall.allTime;
	expect(m.weekend.sessions).toBe(1);
	expect(m.weekday.sessions).toBe(1);
	expect(m.weekday.timeMs).toBe(120_000);
});

test("projects and characters are ranked by session count", () => {
	const { cache, attribution } = build([
		{ session: "a", project: "owner/big", character: "batman", day: TODAY },
		{ session: "b", project: "owner/big", character: "batman", day: TODAY - 1 },
		{ session: "c", project: "owner/small", character: "robin", day: TODAY },
	]);
	const m = deriveAllMetrics(attribution, cache, clock);
	expect(m.projects.map((p) => p.key)).toEqual(["owner/big", "owner/small"]);
	expect(m.projects[0]?.allTime.sessionCount).toBe(2);
	expect(m.characters[0]?.key).toBe("batman");
});

test("total tokens sum across the window", () => {
	const tokens: TokenSums = { input: 10, output: 5, cache_read: 100, cache_creation: 20 };
	const { cache, attribution } = build([
		{ session: "a", project: "p", character: "batman", day: TODAY, tokens },
		{ session: "b", project: "p", character: "batman", day: TODAY, tokens },
	]);
	const m = deriveAllMetrics(attribution, cache, clock).overall.allTime;
	expect(m.totalTokens).toEqual({ input: 20, output: 10, cache_read: 200, cache_creation: 40 });
});
