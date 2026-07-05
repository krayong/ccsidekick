// The Stats board's pure view-model reducer: given the full metric catalog and the active (dimension, window,
// entry) selection, reduce the selected MetricGroup into labeled, grouped grid rows (Volume, Time, Rhythm,
// Highlights), a weekday/weekend split, a cost-vs-budget line, per-model bars, and the heatmap/sparkline series.
// The entry index selects which ranked project/character to show. Nullable MetricGroup fields render "—", never
// "null". No I/O, no Ink: StatsSection renders this and applies row-budget degradation.

import type { AllMetrics, DayBucket, MetricGroup } from "../../derived";
import { fmtUsd, humanize, ladder } from "../../format";

export interface StatsGridRow {
	readonly label: string;
	readonly value: string;
}

export interface StatsGroup {
	readonly heading: string;
	readonly rows: readonly StatsGridRow[];
}

/** The selected ranked entry for the Project/Character dimensions, driving the switcher row. */
export interface StatsEntry {
	readonly key: string;
	readonly index: number;
	readonly count: number;
}

export interface StatsModelBar {
	readonly label: string;
	readonly ratio: number;
	readonly caption: string;
}

export interface StatsCost {
	readonly show: boolean;
	readonly budgetRatio: number | null;
	readonly text: string;
}

export interface StatsView {
	readonly empty: boolean;
	readonly groups: readonly StatsGroup[];
	readonly entry: StatsEntry | null;
	readonly weekday: StatsGridRow;
	readonly weekend: StatsGridRow;
	readonly cost: StatsCost;
	readonly heatmap: readonly number[];
	readonly sparkline: readonly number[];
	readonly models: readonly StatsModelBar[];
}

const NONE = "—";
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const fmtDuration = (ms: number): string => ladder(ms).join(" ");

const bucketLine = (label: string, bucket: DayBucket): StatsGridRow => ({
	label,
	value: `${String(bucket.sessions)} sessions · ${fmtDuration(bucket.timeMs)} · ${fmtUsd(bucket.costUsd)}`,
});

/**
 * The labeled, grouped stat rows for one MetricGroup, in reading order (highest-priority group first). The
 * Highlights group drops the row that is redundant under its own dimension: Top project under Project (dim 1),
 * Favorite character under Character (dim 2).
 */
function groupsFor(group: MetricGroup, dimension: 0 | 1 | 2): readonly StatsGroup[] {
	const volume: readonly StatsGridRow[] = [
		{ label: "Sessions", value: String(group.sessionCount) },
		{ label: "Active days", value: String(group.activeDays) },
		{ label: "Sessions/day", value: group.sessionsPerDay.toFixed(1) },
		{
			label: "Streak",
			value: `${String(group.currentStreakDays)}d (best ${String(group.longestStreakDays)}d)`,
		},
	];
	const time: readonly StatsGridRow[] = [
		{ label: "Total time", value: fmtDuration(group.totalTimeMs) },
		{ label: "Median session", value: fmtDuration(group.medianDurationMs) },
		{ label: "Longest session", value: fmtDuration(group.maxDurationMs) },
	];
	const rhythm: readonly StatsGridRow[] = [
		{
			label: "Peak hour",
			value: group.peakHour === null ? NONE : `${String(group.peakHour).padStart(2, "0")}:00`,
		},
		{
			label: "Busiest weekday",
			value:
				group.busiestWeekday === null ?
					NONE
				:	(WEEKDAY_NAMES[group.busiestWeekday] ?? NONE),
		},
	];
	const highlights: StatsGridRow[] = [
		{ label: "Median cost", value: fmtUsd(group.medianCostUsd) },
	];
	if (dimension !== 1)
		highlights.push({
			label: "Top project",
			value:
				group.mostExpensive === null ?
					NONE
				:	`${group.mostExpensive.key} (${fmtUsd(group.mostExpensive.costUsd)})`,
		});
	if (dimension !== 2)
		highlights.push({
			label: "Favorite character",
			value:
				group.favoriteCharacter === null ?
					NONE
				:	`${group.favoriteCharacter.character} (${String(group.favoriteCharacter.sessions)})`,
		});

	return [
		{ heading: "Volume", rows: volume },
		{ heading: "Time", rows: time },
		{ heading: "Rhythm", rows: rhythm },
		{ heading: "Highlights", rows: highlights },
	];
}

/**
 * Select the MetricGroup and (for Project/Character) the ranked entry for the active dimension/window/index.
 * Overall (list null) has no key; the keyed entries carry `.key`. Branching so `.key` is only read on a keyed
 * entry keeps this cast-free (a cast would trip no-unnecessary-type-assertion).
 */
function selectGroup(
	metrics: AllMetrics,
	dimension: 0 | 1 | 2,
	windowKey: "allTime" | "recent",
	entryIndex: number,
): { group: MetricGroup | null; entry: StatsEntry | null } {
	const list =
		dimension === 1 ? metrics.projects
		: dimension === 2 ? metrics.characters
		: null;
	if (list === null) return { group: metrics.overall[windowKey], entry: null };
	if (list.length === 0) return { group: null, entry: null };
	const idx = Math.max(0, Math.min(entryIndex, list.length - 1));
	const e = list[idx];
	if (e === undefined) return { group: null, entry: null };
	return { group: e[windowKey], entry: { key: e.key, index: idx, count: list.length } };
}

/** Reduce the full metric catalog for the active (dimension, window, entry) selection into the board view model. */
export function statsView(
	metrics: AllMetrics,
	dimension: 0 | 1 | 2,
	windowIdx: 0 | 1,
	entryIndex: number,
	budgetUsd?: number,
): StatsView {
	const windowKey: "allTime" | "recent" = windowIdx === 0 ? "allTime" : "recent";
	const { group, entry } = selectGroup(metrics, dimension, windowKey, entryIndex);

	const hasBudget = budgetUsd !== undefined && budgetUsd > 0;
	const cost: StatsCost = {
		show: dimension !== 2,
		budgetRatio: hasBudget && group !== null ? group.totalCostUsd / budgetUsd : null,
		text:
			group === null ? fmtUsd(0)
			: hasBudget ? `${fmtUsd(group.totalCostUsd)} / ${fmtUsd(budgetUsd)}`
			: fmtUsd(group.totalCostUsd),
	};

	return {
		empty: group === null || group.sessionCount === 0,
		groups: group === null ? [] : groupsFor(group, dimension),
		entry,
		weekday:
			group === null ?
				{ label: "Weekday", value: NONE }
			:	bucketLine("Weekday", group.weekday),
		weekend:
			group === null ?
				{ label: "Weekend", value: NONE }
			:	bucketLine("Weekend", group.weekend),
		cost,
		heatmap: metrics.daily.map((d) => d.sessions),
		sparkline: metrics.daily.map((d) => d.sessions),
		models: metrics.models.map((m) => ({
			label: m.key,
			ratio: m.share,
			caption: `${fmtUsd(m.costUsd)} · ${humanize(m.tokens)} tok`,
		})),
	};
}
