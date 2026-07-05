// Pure reducer tests for statsView: MetricGroup + AllMetrics -> the Stats board's view model. No Ink, no I/O.
import { expect, test } from "bun:test";

import type { AllMetrics, MetricGroup } from "../../../src/derived";
import { type StatsGridRow, statsView } from "../../../src/tui/sections";

function mg(over: Partial<MetricGroup> = {}): MetricGroup {
	return {
		sessionCount: 0,
		lastWorkingMs: null,
		workingSinceMs: null,
		activeDays: 0,
		currentStreakDays: 0,
		longestStreakDays: 0,
		busiestWeekday: null,
		peakHour: null,
		sessionsPerDay: 0,
		maxDurationMs: 0,
		maxDurationOwner: null,
		totalTimeMs: 0,
		medianDurationMs: 0,
		totalCostUsd: 0,
		medianCostUsd: 0,
		mostExpensive: null,
		totalTokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
		favoriteCharacter: null,
		longestGapMs: 0,
		comebackGapMs: null,
		isComeback: false,
		weekday: { sessions: 0, timeMs: 0, costUsd: 0 },
		weekend: { sessions: 0, timeMs: 0, costUsd: 0 },
		...over,
	};
}

function metricsWith(group: MetricGroup, over: Partial<AllMetrics> = {}): AllMetrics {
	return {
		overall: { allTime: group, recent: group },
		projects: [],
		characters: [],
		daily: [],
		models: [],
		...over,
	};
}

/** A ranked project/character entry: same group for both windows (window selection is tested via overall). */
const entry = (
	key: string,
	group: MetricGroup,
): { key: string; allTime: MetricGroup; recent: MetricGroup } => ({
	key,
	allTime: group,
	recent: group,
});

/** All grid rows across every group, flattened, for label lookups. */
const allRows = (groups: readonly { rows: readonly StatsGridRow[] }[]): readonly StatsGridRow[] =>
	groups.flatMap((g) => g.rows);

const fullGroup = mg({
	sessionCount: 12,
	activeDays: 5,
	currentStreakDays: 3,
	longestStreakDays: 7,
	sessionsPerDay: 2.4,
	medianDurationMs: 90_000,
	maxDurationMs: 3_600_000,
	totalTimeMs: 7_200_000,
	peakHour: 14,
	busiestWeekday: 2,
	medianCostUsd: 0.42,
	totalCostUsd: 4.2,
	mostExpensive: { key: "acme", costUsd: 3.1 },
	favoriteCharacter: { character: "batman", sessions: 8 },
	weekday: { sessions: 9, timeMs: 5_400_000, costUsd: 3.2 },
	weekend: { sessions: 3, timeMs: 1_800_000, costUsd: 1.0 },
});

test("statsView reduces the selected group into labeled grid rows with concrete values", () => {
	const view = statsView(metricsWith(fullGroup), 0, 0, 0);
	const row = (label: string) => allRows(view.groups).find((r) => r.label === label);
	expect(row("Sessions")?.value).toBe("12");
	expect(row("Active days")?.value).toBe("5");
	expect(row("Median cost")?.value).toBe("$0.42");
	expect(row("Top project")?.value).toBe("acme ($3.10)");
	expect(row("Favorite character")?.value).toBe("batman (8)");
});

test("statsView groups the board Volume, Time, Rhythm, Highlights in reading order", () => {
	const view = statsView(metricsWith(fullGroup), 0, 0, 0);
	expect(view.groups.map((g) => g.heading)).toEqual(["Volume", "Time", "Rhythm", "Highlights"]);
	expect(view.entry).toBeNull();
});

test("statsView renders a placeholder, never null or a crash, for nullable fields", () => {
	const view = statsView(metricsWith(mg({ sessionCount: 1 })), 0, 0, 0);
	const row = (label: string) => allRows(view.groups).find((r) => r.label === label);
	expect(row("Peak hour")?.value).toBe("—");
	expect(row("Busiest weekday")?.value).toBe("—");
	expect(row("Top project")?.value).toBe("—");
	expect(row("Favorite character")?.value).toBe("—");
	for (const r of allRows(view.groups)) {
		expect(r.value).not.toBe("null");
		expect(r.value).not.toContain("undefined");
	}
});

test("statsView reads the weekday/weekend split off the group", () => {
	const view = statsView(metricsWith(fullGroup), 0, 0, 0);
	expect(view.weekday.value).toContain("9 sessions");
	expect(view.weekend.value).toContain("3 sessions");
});

test("statsView reads per-model bars off AllMetrics.models", () => {
	const metrics = metricsWith(fullGroup, {
		models: [{ key: "sonnet", costUsd: 2.1, tokens: 50_000, share: 0.7 }],
	});
	const view = statsView(metrics, 0, 0, 0);
	expect(view.models).toEqual([{ label: "sonnet", ratio: 0.7, caption: "$2.10 · 50k tok" }]);
});

test("statsView reads the heatmap/sparkline series off AllMetrics.daily", () => {
	const daily = [
		{ day: 1, sessions: 2, costUsd: 0 },
		{ day: 2, sessions: 0, costUsd: 0 },
	];
	const view = statsView(metricsWith(fullGroup, { daily }), 0, 0, 0);
	expect(view.heatmap).toEqual([2, 0]);
	expect(view.sparkline).toEqual([2, 0]);
});

test("statsView.empty is true when sessionCount is 0", () => {
	const view = statsView(metricsWith(mg()), 0, 0, 0);
	expect(view.empty).toBe(true);
});

test("statsView.empty is true and entry null when the dimension has no entries", () => {
	const view = statsView(metricsWith(fullGroup, { projects: [] }), 1, 0, 0);
	expect(view.empty).toBe(true);
	expect(view.groups).toEqual([]);
	expect(view.entry).toBeNull();
});

test("statsView.cost hides under the Character dimension and computes a budget ratio when given one", () => {
	const overall = metricsWith(fullGroup);
	expect(statsView(overall, 2, 0, 0).cost.show).toBe(false);
	const withBudget = statsView(overall, 0, 0, 0, 10);
	expect(withBudget.cost.budgetRatio).toBeCloseTo(0.42);
	expect(withBudget.cost.text).toBe("$4.20 / $10.00");
	const withoutBudget = statsView(overall, 0, 0, 0);
	expect(withoutBudget.cost.budgetRatio).toBeNull();
	expect(withoutBudget.cost.text).toBe("$4.20");
});

test("statsView exposes a switchable entry and reads the indexed character", () => {
	const metrics = metricsWith(fullGroup, {
		characters: [
			entry("batman", mg({ sessionCount: 8 })),
			entry("robin", mg({ sessionCount: 3 })),
		],
	});
	const first = statsView(metrics, 2, 0, 0);
	expect(first.entry).toEqual({ key: "batman", index: 0, count: 2 });
	expect(allRows(first.groups).find((r) => r.label === "Sessions")?.value).toBe("8");
	const second = statsView(metrics, 2, 0, 1);
	expect(second.entry).toEqual({ key: "robin", index: 1, count: 2 });
	expect(allRows(second.groups).find((r) => r.label === "Sessions")?.value).toBe("3");
});

test("statsView clamps an out-of-range entry index to the last entry", () => {
	const metrics = metricsWith(fullGroup, {
		characters: [
			entry("batman", mg({ sessionCount: 8 })),
			entry("robin", mg({ sessionCount: 3 })),
		],
	});
	const view = statsView(metrics, 2, 0, 9);
	expect(view.entry?.index).toBe(1);
	expect(view.entry?.key).toBe("robin");
});

test("Highlights drops the Favorite character row under the Character dimension", () => {
	const metrics = metricsWith(fullGroup, { characters: [entry("batman", fullGroup)] });
	const view = statsView(metrics, 2, 0, 0);
	const highlights = view.groups.find((g) => g.heading === "Highlights");
	expect(highlights?.rows.map((r) => r.label)).not.toContain("Favorite character");
	expect(highlights?.rows.map((r) => r.label)).toContain("Top project");
});

test("Highlights drops the Top project row under the Project dimension", () => {
	const metrics = metricsWith(fullGroup, { projects: [entry("acme", fullGroup)] });
	const view = statsView(metrics, 1, 0, 0);
	const highlights = view.groups.find((g) => g.heading === "Highlights");
	expect(highlights?.rows.map((r) => r.label)).not.toContain("Top project");
	expect(highlights?.rows.map((r) => r.label)).toContain("Favorite character");
});
