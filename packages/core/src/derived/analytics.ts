import {
	COMEBACK_GAP_DAYS,
	DAILY_WINDOW_DAYS,
	RECENT_WINDOW_DAYS,
	STREAK_GRACE_DAYS,
	TIER_THRESHOLDS,
	type Project,
	type Tier,
} from "../domain";
import type { AttributionStore, Clock, CostCache } from "../sources";

import { modelKeyOf } from "./pricing";

const MS_PER_DAY = 86_400_000;

/** The render-path familiarity subset (the full metric catalog is computed here in core, used by the TUI path). */
export interface Familiarity {
	readonly tier: Tier;
	readonly sessionCount: number;
	readonly seenProject: boolean;
	readonly currentStreakDays: number;
	readonly daysSinceLastSession: number;
	readonly workingSinceMs: number;
}

/** One joined session record: a transcript record + its recorded character (default `"unknown"`) and project. */
interface Joined {
	readonly session: string;
	readonly character: string;
	readonly project: string;
	readonly start: number;
	readonly end: number;
	readonly day: number;
}

/** Calendar-day ordinal (days since the Unix epoch) of `ms` in the injected timezone. */
function dayOrdinal(ms: number, tz: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(ms));
	let y = 0;
	let m = 0;
	let d = 0;
	for (const p of parts) {
		if (p.type === "year") y = Number(p.value);
		else if (p.type === "month") m = Number(p.value);
		else if (p.type === "day") d = Number(p.value);
	}
	return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** A session's cost-cache file entries merged: earliest start, latest end, summed tokens, representative project. */
interface SessionAgg {
	start: number;
	end: number;
	tokens: TokenTotals;
	projectRaw: string;
}

/**
 * Merge each session's cost-cache file entries — its main transcript plus its Task sub-agent files, which share
 * the parent `sessionId` — into one aggregate. One entry per session, so sub-agent files and resumed-session
 * files never inflate session counts. The `"default"` session is never included.
 */
function groupBySession(cache: CostCache): Map<string, SessionAgg> {
	const bySession = new Map<string, SessionAgg>();
	for (const entry of Object.values(cache.files)) {
		const rec = entry.record;
		const session = String(rec.session);
		if (session === "default") continue;
		const g = bySession.get(session);
		if (g) {
			if (rec.start < g.start) g.start = rec.start;
			if (rec.end > g.end) g.end = rec.end;
			g.tokens = {
				input: g.tokens.input + rec.tokens.input,
				output: g.tokens.output + rec.tokens.output,
				cache_read: g.tokens.cache_read + rec.tokens.cache_read,
				cache_creation: g.tokens.cache_creation + rec.tokens.cache_creation,
			};
		} else {
			bySession.set(session, {
				start: rec.start,
				end: rec.end,
				tokens: { ...rec.tokens },
				projectRaw: String(rec.project),
			});
		}
	}
	return bySession;
}

/** Join each session (its file entries merged) with its attribution; the `"default"` session is never counted. */
function joinRecords(attribution: AttributionStore, cache: CostCache, tz: string): Joined[] {
	const out: Joined[] = [];
	for (const [session, g] of groupBySession(cache)) {
		const attr = attribution[session];
		out.push({
			session,
			character: attr?.character ?? "unknown",
			project: attr?.project ?? g.projectRaw,
			start: g.start,
			end: g.end,
			day: dayOrdinal(g.start, tz),
		});
	}
	return out;
}

function tierForCount(n: number): Tier {
	const [t1, t2, t3, t4] = TIER_THRESHOLDS;
	if (n < t1) return "stranger";
	if (n < t2) return "acquaintance";
	if (n < t3) return "friend";
	if (n < t4) return "partner";
	return "legend";
}

/**
 * Current streak: consecutive active days ending today, surviving one missed day (`STREAK_GRACE_DAYS`) before
 * it breaks; a fully broken streak reads `0`.
 */
function currentStreak(activeDays: ReadonlySet<number>, today: number): number {
	let streak = 0;
	let grace = STREAK_GRACE_DAYS;
	for (let cursor = today; ; cursor -= 1) {
		if (activeDays.has(cursor)) {
			streak += 1;
		} else if (grace > 0) {
			grace -= 1;
		} else {
			break;
		}
	}
	return streak;
}

/**
 * Render-path familiarity for the active Character: Session Count (→ tier), global first-contact
 * (`seenProject`), the current streak, days since the last session, and Working Since. Per-Character signals
 * filter the joined record set to `character`; `seenProject` is global across characters. Pure: no I/O beyond
 * the injected `clock`; reduces over the costCache analytics records joined with the attribution store.
 */
export function deriveFamiliarity(
	attribution: AttributionStore,
	character: string,
	cache: CostCache,
	project: Project,
	clock: Clock,
	/** The current session id, excluded from the "days since last session" gap (its end is ~now, which would
	 * otherwise zero out the gap and suppress the comeback signal). Defaults to none for callers that don't
	 * track it (e.g. the analytics catalog). */
	currentSession = "",
): Familiarity {
	const tz = clock.timezone();
	const records = joinRecords(attribution, cache, tz);

	const seenProject = records.some((r) => r.project === String(project));

	const mine = records.filter((r) => r.character === character);
	const sessionCount = mine.length;

	const activeDays = new Set<number>(mine.map((r) => r.day));
	const today = dayOrdinal(clock.now(), tz);
	const currentStreakDays = currentStreak(activeDays, today);

	let lastEnd = Number.NEGATIVE_INFINITY;
	let workingSinceMs = Number.POSITIVE_INFINITY;
	for (const r of mine) {
		if (r.start < workingSinceMs) workingSinceMs = r.start;
		// The current session ends ~now; counting it as the "last session" zeroes the gap and hides comeback.
		// Skip it so the gap measures to the previous session, regardless of when attribution was written.
		if (r.session === currentSession) continue;
		if (r.end > lastEnd) lastEnd = r.end;
	}
	const daysSinceLastSession =
		Number.isFinite(lastEnd) ?
			Math.floor((clock.now() - lastEnd) / MS_PER_DAY)
		:	Number.POSITIVE_INFINITY;

	return {
		tier: tierForCount(sessionCount),
		sessionCount,
		seenProject,
		currentStreakDays,
		daysSinceLastSession,
		workingSinceMs: Number.isFinite(workingSinceMs) ? workingSinceMs : 0,
	};
}

// ── Full metric catalog (TUI-only) ────────────────────────────────────────────

/** Per-class token totals for a group (`cache_creation` already merged). */
interface TokenTotals {
	readonly input: number;
	readonly output: number;
	readonly cache_read: number;
	readonly cache_creation: number;
}

/** Sessions / time / cost bucketed for one weekday class (weekday vs weekend). */
export interface DayBucket {
	readonly sessions: number;
	readonly timeMs: number;
	readonly costUsd: number;
}

/** One fully reduced metric group for a (dimension, window) pair. */
export interface MetricGroup {
	readonly sessionCount: number;
	/** Most recent `end` in the window, or null when empty. */
	readonly lastWorkingMs: number | null;
	/** Earliest `start` across all-time records (window-independent). */
	readonly workingSinceMs: number | null;
	readonly activeDays: number;
	readonly currentStreakDays: number;
	/** Longest run of consecutive active days, all-time (window-independent). */
	readonly longestStreakDays: number;
	/** Weekday (0 = Sun … 6 = Sat) of the calendar day holding the most sessions. */
	readonly busiestWeekday: number | null;
	/** Local hour (0–23) with the most session starts. */
	readonly peakHour: number | null;
	readonly sessionsPerDay: number;
	readonly maxDurationMs: number;
	/** Session id owning the longest session. */
	readonly maxDurationOwner: string | null;
	readonly totalTimeMs: number;
	readonly medianDurationMs: number;
	readonly totalCostUsd: number;
	readonly medianCostUsd: number;
	/** Project with the largest summed cost in the window. */
	readonly mostExpensive: { readonly key: string; readonly costUsd: number } | null;
	readonly totalTokens: TokenTotals;
	readonly favoriteCharacter: { readonly character: string; readonly sessions: number } | null;
	/** Longest end→next-start gap, all-time (window-independent). */
	readonly longestGapMs: number;
	/** Current gap (`now − all-time last working`), or null when never worked. */
	readonly comebackGapMs: number | null;
	readonly isComeback: boolean;
	readonly weekday: DayBucket;
	readonly weekend: DayBucket;
}

/** A ranked per-dimension entry (project or character) with both windows. */
interface DimensionEntry {
	readonly key: string;
	readonly allTime: MetricGroup;
	readonly recent: MetricGroup;
}

/** The full catalog: Overall (both windows) plus ranked Project and Character entries. */
export interface AllMetrics {
	readonly overall: { readonly allTime: MetricGroup; readonly recent: MetricGroup };
	readonly projects: readonly DimensionEntry[];
	readonly characters: readonly DimensionEntry[];
	readonly daily: readonly DailyPoint[];
	readonly models: readonly ModelCost[];
}

/** One calendar day's activity, for the Stats heatmap/sparkline. */
interface DailyPoint {
	readonly day: number;
	readonly sessions: number;
	readonly costUsd: number;
}

/** One model's all-time cost + token totals and its share of total spend, ranked descending by cost. */
interface ModelCost {
	/** Canonical model key (or the raw id when it resolves to nothing). */
	readonly key: string;
	readonly costUsd: number;
	readonly tokens: number;
	/** Fraction of total priced cost (0–1); 0 when there is no cost yet. */
	readonly share: number;
}

/** Bucket records by day into a zero-filled trailing window ending on `today`, oldest first. */
export function buildDaily(
	records: readonly { readonly day: number; readonly cost: number }[],
	today: number,
	windowDays: number,
): readonly DailyPoint[] {
	const byDay = new Map<number, { sessions: number; costUsd: number }>();
	for (const r of records) {
		const agg = byDay.get(r.day) ?? { sessions: 0, costUsd: 0 };
		byDay.set(r.day, { sessions: agg.sessions + 1, costUsd: agg.costUsd + r.cost });
	}
	const out: DailyPoint[] = [];
	for (let i = windowDays - 1; i >= 0; i--) {
		const day = today - i;
		const agg = byDay.get(day) ?? { sessions: 0, costUsd: 0 };
		out.push({ day, sessions: agg.sessions, costUsd: agg.costUsd });
	}
	return out;
}

/** One joined session carrying every field the full catalog reduces over. */
interface FullRecord {
	readonly session: string;
	readonly project: string;
	readonly character: string;
	readonly start: number;
	readonly end: number;
	readonly duration: number;
	readonly day: number;
	readonly hour: number;
	readonly cost: number;
	readonly tokens: TokenTotals;
}

/** Local hour-of-day (0–23) of `ms` in the injected timezone. */
function hourOfDay(ms: number, tz: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		hour: "2-digit",
		hour12: false,
	}).formatToParts(new Date(ms));
	for (const p of parts) if (p.type === "hour") return Number(p.value) % 24;
	return 0;
}

/**
 * Join each session (its file entries merged) with its attribution; skip `"default"`. Cost is the
 * globally-deduped per-session subtotal (`aggregate.tokenPriced`), not the per-file `total`: a session spans
 * several transcript files (a resume, plus its Task sub-agent files) whose per-file totals each re-price
 * overlapping history, so summing them double-counts. Merging to one record per session also keeps sub-agent
 * and resumed-session files from inflating session counts.
 */
function joinFull(
	attribution: AttributionStore,
	cache: CostCache,
	tz: string,
	normalizeProject: (key: string) => string,
): FullRecord[] {
	const tokenPriced = cache.aggregate.tokenPriced;
	const groups = [...groupBySession(cache)];
	// Learn each repo's checkout-root → owner/repo name from attributed sessions: their attribution carries the
	// `owner/repo` form while their cost record carries the filesystem path, so `normalizeProject(path)` (the
	// `.git`-root walk) keys the map. Unattributed sessions of the same repo then merge under one key instead of
	// splitting into an `owner/repo` bucket (attributed) and a `/abs/path` bucket (unattributed/legacy).
	const rootToName = new Map<string, string>();
	for (const [session, g] of groups) {
		const attr = attribution[session];
		if (attr !== undefined) rootToName.set(normalizeProject(g.projectRaw), attr.project);
	}
	const out: FullRecord[] = [];
	for (const [session, g] of groups) {
		const attr = attribution[session];
		const root = normalizeProject(g.projectRaw);
		out.push({
			session,
			project: attr?.project ?? rootToName.get(root) ?? root,
			character: attr?.character ?? "unknown",
			start: g.start,
			end: g.end,
			duration: Math.max(0, g.end - g.start),
			day: dayOrdinal(g.start, tz),
			hour: hourOfDay(g.start, tz),
			cost: tokenPriced[session] ?? 0,
			tokens: g.tokens,
		});
	}
	return out;
}

function median(xs: readonly number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Longest run of consecutive day ordinals in the set. */
function longestStreak(days: ReadonlySet<number>): number {
	const sorted = [...days].sort((a, b) => a - b);
	let best = 0;
	let run = 0;
	let prev = Number.NaN;
	for (const d of sorted) {
		run = d === prev + 1 ? run + 1 : 1;
		if (run > best) best = run;
		prev = d;
	}
	return best;
}

/** Longest end→next-start gap over records sorted by start; overlaps clamp to 0. */
function longestGap(records: readonly FullRecord[]): number {
	const sorted = [...records].sort((a, b) => a.start - b.start);
	let best = 0;
	let prevEnd = Number.NEGATIVE_INFINITY;
	for (const r of sorted) {
		if (Number.isFinite(prevEnd)) best = Math.max(best, r.start - prevEnd);
		if (r.end > prevEnd) prevEnd = r.end;
	}
	return best;
}

/** Pick the key with the highest `sessions`, breaking ties by `timeMs`, then key order. */
function topBySessions(
	groups: Map<string, { sessions: number; timeMs: number }>,
): { key: string; sessions: number } | null {
	let bestKey: string | null = null;
	let best = { sessions: -1, timeMs: -1 };
	for (const [key, g] of groups) {
		if (
			g.sessions > best.sessions ||
			(g.sessions === best.sessions && g.timeMs > best.timeMs)
		) {
			best = g;
			bestKey = key;
		}
	}
	return bestKey === null ? null : { key: bestKey, sessions: best.sessions };
}

function emptyBucket(): { sessions: number; timeMs: number; costUsd: number } {
	return { sessions: 0, timeMs: 0, costUsd: 0 };
}

interface WindowedAgg {
	dayCounts: Map<number, { sessions: number; timeMs: number }>;
	hourCounts: number[];
	projectCost: Map<string, number>;
	charCounts: Map<string, { sessions: number; timeMs: number }>;
	weekday: { sessions: number; timeMs: number; costUsd: number };
	weekend: { sessions: number; timeMs: number; costUsd: number };
	tokens: { input: number; output: number; cache_read: number; cache_creation: number };
	lastWorkingMs: number | null;
	totalTimeMs: number;
	totalCostUsd: number;
	maxDurationMs: number;
	maxDurationOwner: string | null;
	durations: number[];
	costs: number[];
}

/** One linear pass over the windowed records, folding every per-window aggregate the group reports. */
function accumulateWindowed(windowed: readonly FullRecord[]): WindowedAgg {
	const dayCounts = new Map<number, { sessions: number; timeMs: number }>();
	const hourCounts = new Array<number>(24).fill(0);
	const projectCost = new Map<string, number>();
	const charCounts = new Map<string, { sessions: number; timeMs: number }>();
	const weekday = emptyBucket();
	const weekend = emptyBucket();
	const tokens = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };

	let lastWorkingMs: number | null = null;
	let totalTimeMs = 0;
	let totalCostUsd = 0;
	let maxDurationMs = 0;
	let maxDurationOwner: string | null = null;
	const durations: number[] = [];
	const costs: number[] = [];

	for (const r of windowed) {
		if (lastWorkingMs === null || r.end > lastWorkingMs) lastWorkingMs = r.end;
		totalTimeMs += r.duration;
		totalCostUsd += r.cost;
		durations.push(r.duration);
		costs.push(r.cost);
		if (r.duration > maxDurationMs) {
			maxDurationMs = r.duration;
			maxDurationOwner = r.session;
		}
		const dc = dayCounts.get(r.day) ?? { sessions: 0, timeMs: 0 };
		dayCounts.set(r.day, { sessions: dc.sessions + 1, timeMs: dc.timeMs + r.duration });
		hourCounts[r.hour] = (hourCounts[r.hour] ?? 0) + 1;
		projectCost.set(r.project, (projectCost.get(r.project) ?? 0) + r.cost);
		if (r.character !== "unknown") {
			const cc = charCounts.get(r.character) ?? { sessions: 0, timeMs: 0 };
			charCounts.set(r.character, {
				sessions: cc.sessions + 1,
				timeMs: cc.timeMs + r.duration,
			});
		}
		const weekdayIdx = (((r.day + 4) % 7) + 7) % 7;
		const bucket = weekdayIdx === 0 || weekdayIdx === 6 ? weekend : weekday;
		bucket.sessions += 1;
		bucket.timeMs += r.duration;
		bucket.costUsd += r.cost;
		tokens.input += r.tokens.input;
		tokens.output += r.tokens.output;
		tokens.cache_read += r.tokens.cache_read;
		tokens.cache_creation += r.tokens.cache_creation;
	}

	return {
		dayCounts,
		hourCounts,
		projectCost,
		charCounts,
		weekday,
		weekend,
		tokens,
		lastWorkingMs,
		totalTimeMs,
		totalCostUsd,
		maxDurationMs,
		maxDurationOwner,
		durations,
		costs,
	};
}

/** The weekday (0=Sun…6=Sat) of the busiest day by sessions (tie by time); null when there were no days. */
function busiestWeekdayOf(
	dayCounts: Map<number, { sessions: number; timeMs: number }>,
): number | null {
	let busiestDay: number | null = null;
	let busiest = { sessions: -1, timeMs: -1 };
	for (const [day, g] of dayCounts) {
		if (
			g.sessions > busiest.sessions ||
			(g.sessions === busiest.sessions && g.timeMs > busiest.timeMs)
		) {
			busiest = g;
			busiestDay = day;
		}
	}
	return busiestDay === null ? null : (((busiestDay + 4) % 7) + 7) % 7;
}

/** The hour (0–23) with the most sessions; null when there were none. */
function peakHourOf(hourCounts: readonly number[]): number | null {
	let peakHour: number | null = null;
	let peakCount = 0;
	hourCounts.forEach((count, hour) => {
		if (count > peakCount) {
			peakCount = count;
			peakHour = hour;
		}
	});
	return peakHour;
}

/** The project key with the highest total cost; null when there were none. */
function topByCost(projectCost: Map<string, number>): { key: string; costUsd: number } | null {
	let mostExpensive: { key: string; costUsd: number } | null = null;
	for (const [key, costUsd] of projectCost) {
		if (mostExpensive === null || costUsd > mostExpensive.costUsd)
			mostExpensive = { key, costUsd };
	}
	return mostExpensive;
}

/** The window-independent metrics for a key, computed once from its all-time record set and shared into both windows. */
interface AllTimeShared {
	readonly workingSinceMs: number | null;
	readonly longestStreakDays: number;
	readonly longestGapMs: number;
	readonly comebackGapMs: number | null;
	readonly isComeback: boolean;
}

/** Fold the all-time-only metrics (earliest start, active-day set, longest streak/gap, comeback gap) in one pass. */
function allTimeShared(all: readonly FullRecord[], nowMs: number): AllTimeShared {
	let workingSinceMs: number | null = null;
	let allLastWorking: number | null = null;
	const allDays = new Set<number>();
	for (const r of all) {
		if (workingSinceMs === null || r.start < workingSinceMs) workingSinceMs = r.start;
		if (allLastWorking === null || r.end > allLastWorking) allLastWorking = r.end;
		allDays.add(r.day);
	}
	const comebackGapMs = allLastWorking === null ? null : nowMs - allLastWorking;
	return {
		workingSinceMs,
		longestStreakDays: longestStreak(allDays),
		longestGapMs: longestGap(all),
		comebackGapMs,
		isComeback: comebackGapMs !== null && comebackGapMs > COMEBACK_GAP_DAYS * MS_PER_DAY,
	};
}

/**
 * Reduce a record set to one metric group. Window-dependent metrics read `windowed`; the inherently all-time
 * metrics (Working Since, Longest Streak, Longest Gap, Comeback) come precomputed in `shared`, so a key's two
 * windows share one all-time pass.
 */
function computeGroup(
	shared: AllTimeShared,
	windowed: readonly FullRecord[],
	today: number,
): MetricGroup {
	const agg = accumulateWindowed(windowed);
	const activeDays = agg.dayCounts.size;
	const currentStreakDays = currentStreak(new Set(agg.dayCounts.keys()), today);
	const fav = topBySessions(agg.charCounts);

	return {
		sessionCount: windowed.length,
		lastWorkingMs: agg.lastWorkingMs,
		workingSinceMs: shared.workingSinceMs,
		activeDays,
		currentStreakDays,
		longestStreakDays: shared.longestStreakDays,
		busiestWeekday: busiestWeekdayOf(agg.dayCounts),
		peakHour: peakHourOf(agg.hourCounts),
		sessionsPerDay: activeDays === 0 ? 0 : windowed.length / activeDays,
		maxDurationMs: agg.maxDurationMs,
		maxDurationOwner: agg.maxDurationOwner,
		totalTimeMs: agg.totalTimeMs,
		medianDurationMs: median(agg.durations),
		totalCostUsd: agg.totalCostUsd,
		medianCostUsd: median(agg.costs),
		mostExpensive: topByCost(agg.projectCost),
		totalTokens: agg.tokens,
		favoriteCharacter: fav === null ? null : { character: fav.key, sessions: fav.sessions },
		longestGapMs: shared.longestGapMs,
		comebackGapMs: shared.comebackGapMs,
		isComeback: shared.isComeback,
		weekday: agg.weekday,
		weekend: agg.weekend,
	};
}

/** Rank distinct keys of `records` by all-time session count (desc), tie by key (asc). */
function rankKeys(records: readonly FullRecord[], pick: (r: FullRecord) => string): string[] {
	const counts = new Map<string, number>();
	for (const r of records) counts.set(pick(r), (counts.get(pick(r)) ?? 0) + 1);
	return [...counts.keys()].sort(
		(a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1),
	);
}

/**
 * The full TUI analytics catalog: reduce the joined costCache + attribution record set into Overall, ranked
 * Project, and ranked Character groups, each for the all-time and recent (`RECENT_WINDOW_DAYS`) windows. Pure:
 * no I/O beyond the injected `clock`. This is the only place the full catalog is computed; the render path uses
 * the lean `deriveFamiliarity` subset instead.
 */
export function deriveAllMetrics(
	attribution: AttributionStore,
	cache: CostCache,
	clock: Clock,
	normalizeProject: (key: string) => string = (k) => k,
): AllMetrics {
	const tz = clock.timezone();
	const nowMs = clock.now();
	const today = dayOrdinal(nowMs, tz);
	const recentCutoff = nowMs - RECENT_WINDOW_DAYS * MS_PER_DAY;

	const all = joinFull(attribution, cache, tz, normalizeProject);
	const recent = all.filter((r) => r.start >= recentCutoff);

	const group = (
		allSet: readonly FullRecord[],
		recentSet: readonly FullRecord[],
	): { allTime: MetricGroup; recent: MetricGroup } => {
		const shared = allTimeShared(allSet, nowMs);
		return {
			allTime: computeGroup(shared, allSet, today),
			recent: computeGroup(shared, recentSet, today),
		};
	};

	const projects: DimensionEntry[] = rankKeys(all, (r) => r.project).map((key) => ({
		key,
		...group(
			all.filter((r) => r.project === key),
			recent.filter((r) => r.project === key),
		),
	}));

	const characters: DimensionEntry[] = rankKeys(all, (r) => r.character).map((key) => ({
		key,
		...group(
			all.filter((r) => r.character === key),
			recent.filter((r) => r.character === key),
		),
	}));

	return {
		overall: group(all, recent),
		projects,
		characters,
		daily: buildDaily(all, today, DAILY_WINDOW_DAYS),
		models: buildModels(cache.aggregate.byModel),
	};
}

/** Fold the raw-model-keyed spend map into canonical-key rows, ranked by cost with each row's cost share. */
export function buildModels(byModel: CostCache["aggregate"]["byModel"]): readonly ModelCost[] {
	const byCanon = new Map<string, { cost: number; tokens: number }>();
	for (const [raw, spend] of Object.entries(byModel)) {
		const key = modelKeyOf(raw);
		const acc = byCanon.get(key) ?? { cost: 0, tokens: 0 };
		acc.cost += spend.cost;
		acc.tokens += spend.tokens;
		byCanon.set(key, acc);
	}
	let totalCost = 0;
	for (const v of byCanon.values()) totalCost += v.cost;
	return [...byCanon.entries()]
		.map(([key, v]) => ({
			key,
			costUsd: v.cost,
			tokens: v.tokens,
			share: totalCost > 0 ? v.cost / totalCost : 0,
		}))
		.sort((a, b) => b.costUsd - a.costUsd);
}
