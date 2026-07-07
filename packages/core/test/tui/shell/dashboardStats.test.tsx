// packages/core/test/tui/shell/dashboardStats.test.tsx
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import type { AllMetrics, MetricGroup } from "../../../src/derived";
import { DEFAULT_CONFIG } from "../../../src/sources";
import { type DashboardProps, Dashboard } from "../../../src/tui/shell";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const tick = async (): Promise<void> => new Promise((r) => setTimeout(r, 25));

// Arrow-key escape sequences: the Stats axis rows are driven by the real arrows (ijkl now scrolls the board).
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";

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

function fixtureMetrics(sessions: number): AllMetrics {
	const group = mg({
		sessionCount: sessions,
		sessionsPerDay: 2,
		currentStreakDays: 3,
		longestStreakDays: 5,
		totalCostUsd: 4.2,
	});
	const daily = Array.from({ length: 60 }, (_, i) => ({
		day: 1000 + i,
		sessions: i % 5,
		costUsd: 0,
	}));
	return {
		overall: { allTime: group, recent: group },
		projects: [{ key: "proj", allTime: group, recent: group }],
		characters: [{ key: "batman", allTime: group, recent: group }],
		daily,
		models: [{ key: "sonnet", costUsd: 2.1, tokens: 50_000, share: 0.7 }],
	};
}

function base(over: Partial<DashboardProps> = {}): DashboardProps {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-stats-"));
	return {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		// Tall enough that the dense board (grid + heatmap + sparkline + weekday split + cost + per-model
		// bars) renders in full, un-degraded; degradation at a forced small budget is covered separately by
		// statsSection.test.tsx.
		rows: 60,
		initialConfig: DEFAULT_CONFIG,
		packs: ["batman"],
		...over,
	};
}

test("the Stats section renders the heatmap, the grid, the cost number, and per-model bars", async () => {
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ metrics: fixtureMetrics(10) })),
	);
	await tick();
	stdin.write("6"); // jump to Stats (section index 5)
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("█"); // heatmap / sparkline
	expect(frame).toContain("Sessions"); // a labeled grid row
	expect(frame).toContain("$4.20");
	expect(frame).toContain("sonnet"); // per-model bar, since fixtureMetrics ships models[]
});

test("the Character dimension hides the cost", async () => {
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ metrics: fixtureMetrics(10) })),
	);
	await tick();
	stdin.write("6");
	await tick();
	stdin.write("\r"); // enter the content zone
	await tick();
	stdin.write(RIGHT); // Overall -> Project
	await tick();
	stdin.write(RIGHT); // Project -> Character
	await tick();
	// StatsSection hides the cost display when dimension === Character (cost.show = false).
	// Assert on the fixture value ($4.20) rather than the label "Cost" — the preview panel always
	// shows "Chat Cost" / "Total Cost" from the status-line scenario, which would false-match.
	expect(lastFrame() ?? "").not.toContain("$4.20");
});

test("the empty catalog shows the no-sessions line", async () => {
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ metrics: fixtureMetrics(0) })),
	);
	await tick();
	stdin.write("6");
	await tick();
	expect((lastFrame() ?? "").toLowerCase()).toContain("no sessions yet");
});

test("focusing the Window axis and pressing left/right toggles the window", async () => {
	const metrics: AllMetrics = {
		...fixtureMetrics(10),
		overall: {
			allTime: mg({
				sessionCount: 10,
				sessionsPerDay: 2,
				currentStreakDays: 3,
				longestStreakDays: 5,
				totalCostUsd: 4.2,
			}),
			// sessionCount must be nonzero: statsView's empty flag is per-selected-group, so a 0-session
			// recent window would show the empty state instead of the recent totals.
			recent: mg({ sessionCount: 5, totalCostUsd: 1.26 }),
		},
	};
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ metrics })));
	await tick();
	stdin.write("6"); // Stats section
	await tick();
	stdin.write("\r"); // enter content zone (focus starts on the View axis)
	await tick();
	expect(lastFrame() ?? "").toContain("$4.20"); // all-time window active
	stdin.write(DOWN); // move focus down to the Window axis
	await tick();
	stdin.write(RIGHT); // change the focused (Window) axis -> recent
	await tick();
	expect(lastFrame() ?? "").toContain("$1.26"); // recent window active
	stdin.write(RIGHT); // toggle back -> all-time
	await tick();
	expect(lastFrame() ?? "").toContain("$4.20"); // back to all-time
});

test("toggling the window leaves the 60-day heatmap unchanged", async () => {
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ metrics: fixtureMetrics(10) })),
	);
	await tick();
	stdin.write("6"); // Stats section
	await tick();
	stdin.write("\r"); // enter content zone
	await tick();
	expect(lastFrame() ?? "").toContain("60-day activity"); // heatmap present before toggle
	stdin.write(DOWN); // focus the Window axis
	await tick();
	stdin.write(RIGHT); // toggle the window
	await tick();
	expect(lastFrame() ?? "").toContain("60-day activity"); // heatmap stable across window change
});

test("focusing the Character entry axis and pressing left/right switches character", async () => {
	const group = mg({ sessionCount: 7, totalCostUsd: 1.0 });
	const other = mg({ sessionCount: 4, totalCostUsd: 1.0 });
	const metrics: AllMetrics = {
		...fixtureMetrics(10),
		characters: [
			{ key: "batman", allTime: group, recent: group },
			{ key: "robin", allTime: other, recent: other },
		],
	};
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ metrics })));
	await tick();
	stdin.write("6"); // Stats section
	await tick();
	stdin.write("\r"); // enter content zone (focus on View)
	await tick();
	stdin.write(RIGHT); // View: Overall -> Project
	await tick();
	stdin.write(RIGHT); // View: Project -> Character (entry row appears)
	await tick();
	expect(lastFrame() ?? "").toContain("batman"); // first-ranked character shown
	stdin.write(DOWN); // focus Window
	await tick();
	stdin.write(DOWN); // focus the entry row
	await tick();
	stdin.write(RIGHT); // next character
	await tick();
	expect(lastFrame() ?? "").toContain("robin");
});

test("Stats section is not shown at floor terminal size", async () => {
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ metrics: fixtureMetrics(10), cols: 50 })),
	);
	await tick();
	stdin.write("6"); // attempt to navigate to Stats
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame.toLowerCase()).toContain("terminal too small");
	expect(frame).not.toContain("Sessions"); // StatsSection never rendered
});
