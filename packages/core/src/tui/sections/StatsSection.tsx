// The read-only Stats section: three focused axis rows (View, Window, and a Project/Character entry switcher)
// pinned at the top, over a scrollable board — a 60-day heatmap + sparkline, labeled stat groups (Volume, Time,
// Rhythm, Highlights), a Weekday/Weekend split, a cost-vs-budget meter, and per-model cost bars. Up/down move the
// focus between axis rows and left/right change the focused axis (arrows); ijkl or the mouse wheel scroll the
// board inside its box (the Dashboard owns the offsets, clamped via statsBoardHeight). Cost hides under the
// Character dimension. Presentational only: every value is passed in; this holds no state, does no I/O.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { displayWidth, padEndDisplay } from "../../render";
import type { Tokens } from "../theme";
import { BarMeter, Heatmap, ProgressBar, ScrollBox, Sparkline } from "../widgets";

import type {
	StatsCost,
	StatsEntry,
	StatsGridRow,
	StatsGroup,
	StatsModelBar,
	StatsView,
} from "./statsView";

/** The `i`-th theme data hue, cycling; `undefined` when `dataHues` is empty (no-color capability). */
function hueAt(dataHues: readonly string[], i: number): string | undefined {
	if (dataHues.length === 0) return undefined;
	return dataHues[i % dataHues.length] ?? dataHues[0];
}

export interface StatsSectionProps {
	readonly dimension: 0 | 1 | 2;
	readonly windowIdx: 0 | 1;
	readonly focus: 0 | 1 | 2; // which axis row is focused: 0 View, 1 Window, 2 Entry
	readonly view: StatsView;
	readonly maxRows: number; // the section's row budget; axis rows pin, the board scrolls within the rest
	readonly contentWidth: number; // the section's usable inner width; drives the grid's column count
	readonly offsetX: number; // horizontal board scroll offset
	readonly offsetY: number; // vertical board scroll offset
	readonly tokens: Tokens;
}

const DIMENSIONS = ["Overall", "Project", "Character"] as const;
const WINDOWS = ["All-time", "Recent 30d"] as const;
const HEATMAP_DAYS = 60;
const CELL_WIDTH = 20; // one stat cell's fixed width; contentWidth / CELL_WIDTH gives the grid's column count

// Row-cost constants used by statsBoardHeight (each <Box marginTop={1}> = 1 blank row; each <Text> = 1 row):
const GRID_MARGIN_ROWS = 1; // marginTop before the grouped grid
const BAND_MARGIN_ROWS = 1; // marginTop before the weekday/cost/models column
const WEEKDAY_ROWS = 3; // marginTop + Weekday line + Weekend line
const COST_MARGIN_ROWS = 1; // marginTop before the cost line
const MODELS_MARGIN_ROWS = 1; // marginTop before the per-model bars
const HEATMAP_ROWS = Math.ceil(HEATMAP_DAYS / 7) + 1; // grid rows + 1 legend row
const SPARKLINE_ROWS = 1; // 1 spark line, directly under the heatmap
const BOARD_MARGIN_ROWS = 1; // the board's own marginTop below the axis rows
const CELL_GAP = 2; // matches StatsGroups' marginRight between cells

/** A cell's rendered display width: the padded label field plus its value plus the trailing gap. */
function cellDisplayWidth(row: StatsGridRow): number {
	return displayWidth(padEndDisplay(`${row.label} `, 12)) + displayWidth(row.value) + CELL_GAP;
}

/** The rendered line count of one group: its marginTop + heading (1) plus its wrapped cell rows. */
function groupLines(group: StatsGroup, gridCols: number, contentWidth: number): number {
	let lines = 1; // heading
	for (let i = 0; i < group.rows.length; i += gridCols) {
		const chunk = group.rows.slice(i, i + gridCols);
		let used = 0;
		let chunkLines = 1;
		for (const row of chunk) {
			const w = cellDisplayWidth(row);
			if (used > 0 && used + w > contentWidth) {
				chunkLines += 1;
				used = w;
			} else used += w;
		}
		lines += chunkLines;
	}
	return 1 + lines; // + this group's marginTop
}

/**
 * The board's full rendered height in rows (heatmap + sparkline + grouped grid + weekday/cost/models band). The
 * Dashboard uses this to clamp the vertical scroll offset so the board never scrolls past its own end. Slightly
 * conservative is fine (a little over-scroll into blank beats never reaching the bottom).
 */
export function statsBoardHeight(view: StatsView, contentWidth: number): number {
	if (view.empty) return 1; // just the empty notice
	const gridCols = Math.max(1, Math.floor(contentWidth / CELL_WIDTH));
	const groupsRows =
		view.groups.length === 0 ?
			0
		:	GRID_MARGIN_ROWS +
			view.groups.reduce((n, g) => n + groupLines(g, gridCols, contentWidth), 0);
	const heatmapRows = HEATMAP_ROWS + SPARKLINE_ROWS;
	const costRows =
		view.cost.show ? COST_MARGIN_ROWS + 1 + (view.cost.budgetRatio !== null ? 1 : 0) : 0;
	const modelRows = view.models.length > 0 ? MODELS_MARGIN_ROWS + view.models.length : 0;
	const bandRows = BAND_MARGIN_ROWS + WEEKDAY_ROWS + costRows + modelRows;
	return heatmapRows + groupsRows + bandRows;
}

/** One focused-axis row: a label prefix, the value pills (active bracketed + accent), and a focus marker. */
function AxisRow(props: {
	readonly label: string;
	readonly values: readonly string[];
	readonly active: number;
	readonly focused: boolean;
	readonly tokens: Tokens;
}): ReactElement {
	const { label, values, active, focused, tokens } = props;
	// Muted pills use a gray COLOR (tokens.frame), not the dimColor attribute: Ink does not reset dimColor
	// between adjacent segments on a line, so a dim inactive pill used to bleed onto the following active pill —
	// dimming every active value except the first (Overall/All-time). A color resets cleanly per segment.
	const muted = tokens.frame;
	return (
		<Box>
			<Text {...(focused ? tokens.accent : muted)}>
				{focused ? "› " : "  "}
				{label.padEnd(10)}
			</Text>
			{values.map((v, i) => (
				<Text key={v} {...(i === active ? tokens.accent : muted)}>
					{i === active ? ` [${v}] ` : `  ${v}  `}
				</Text>
			))}
		</Box>
	);
}

/** The Project/Character entry switcher row: the current key with ‹ › steppers and a position indicator. */
function EntryRow(props: {
	readonly label: string;
	readonly entry: StatsEntry;
	readonly focused: boolean;
	readonly tokens: Tokens;
}): ReactElement {
	const { label, entry, focused, tokens } = props;
	const muted = tokens.frame;
	return (
		<Box>
			<Text {...(focused ? tokens.accent : muted)}>
				{focused ? "› " : "  "}
				{label.padEnd(10)}
			</Text>
			<Text {...tokens.accent}>‹ {entry.key} ›</Text>
			<Text {...muted}>
				{"   "}
				{String(entry.index + 1)} / {String(entry.count)}
			</Text>
		</Box>
	);
}

function EmptyNotice({ tokens }: { readonly tokens: Tokens }): ReactElement {
	return (
		<Box marginTop={1}>
			<Text {...tokens.textMuted}>
				No sessions yet. Your statistics appear here once you start working.
			</Text>
		</Box>
	);
}

function WeekdaySplit(props: {
	readonly weekday: StatsGridRow;
	readonly weekend: StatsGridRow;
	readonly tokens: Tokens;
}): ReactElement {
	const { weekday, weekend, tokens } = props;
	const weekdayHue = hueAt(tokens.dataHues, 0);
	const weekendHue = hueAt(tokens.dataHues, 1);
	const weekdayStyle = weekdayHue === undefined ? tokens.textMuted : { color: weekdayHue };
	const weekendStyle = weekendHue === undefined ? tokens.textMuted : { color: weekendHue };
	return (
		<Box flexDirection="column" marginTop={1}>
			<Text {...tokens.text}>
				{weekday.label}: <Text {...weekdayStyle}>{weekday.value}</Text>
			</Text>
			<Text {...tokens.text}>
				{weekend.label}: <Text {...weekendStyle}>{weekend.value}</Text>
			</Text>
		</Box>
	);
}

function StatsGroups(props: {
	readonly groups: readonly StatsGroup[];
	readonly columns: number; // derived from contentWidth by the caller
	readonly tokens: Tokens;
}): ReactElement | null {
	const { groups, columns, tokens } = props;
	if (groups.length === 0) return null;
	return (
		<Box flexDirection="column" marginTop={1}>
			{groups.map((group) => {
				const lines: (readonly StatsGridRow[])[] = [];
				for (let i = 0; i < group.rows.length; i += columns)
					lines.push(group.rows.slice(i, i + columns));
				return (
					<Box key={group.heading} flexDirection="column" marginTop={1}>
						<Text {...tokens.textMuted}>{group.heading}</Text>
						{lines.map((cells) => (
							<Box key={cells[0]?.label ?? ""} flexDirection="row">
								{cells.map((row) => (
									<Box key={row.label} marginRight={2} flexShrink={0}>
										<Text {...tokens.textMuted}>
											{padEndDisplay(`${row.label} `, 12)}
										</Text>
										<Text {...tokens.text}>{row.value}</Text>
									</Box>
								))}
							</Box>
						))}
					</Box>
				);
			})}
		</Box>
	);
}

function CostBlock(props: {
	readonly cost: StatsCost;
	readonly tokens: Tokens;
}): ReactElement | null {
	const { cost, tokens } = props;
	if (!cost.show) return null;
	return (
		<Box flexDirection="column" marginTop={1}>
			<Text {...tokens.text}>Cost {cost.text}</Text>
			{cost.budgetRatio !== null ?
				<ProgressBar value={Math.round(Math.max(0, Math.min(1, cost.budgetRatio)) * 100)} />
			:	null}
		</Box>
	);
}

function ModelBars(props: {
	readonly models: readonly StatsModelBar[];
	readonly tokens: Tokens;
}): ReactElement | null {
	const { models, tokens } = props;
	if (models.length === 0) return null;
	return (
		<Box flexDirection="column" marginTop={1}>
			{models.map((m, i) => {
				const color = hueAt(tokens.dataHues, i);
				return (
					<BarMeter
						key={m.label}
						label={m.label}
						ratio={m.ratio}
						caption={m.caption}
						tokens={tokens}
						{...(color !== undefined ? { color } : {})}
					/>
				);
			})}
		</Box>
	);
}

/** The count of pinned axis rows above the scrollable board: View + Window, plus the entry/no-entries row. */
export function statsAxisRowCount(dimension: 0 | 1 | 2): number {
	return dimension === 0 ? 2 : 3;
}

export function StatsSection(props: StatsSectionProps): ReactElement {
	const { dimension, windowIdx, focus, view, maxRows, contentWidth, offsetX, offsetY, tokens } =
		props;
	const { weekday, weekend, cost, heatmap, sparkline, models, empty, entry } = view;
	const gridCols = Math.max(1, Math.floor(contentWidth / CELL_WIDTH));
	const boardRows = Math.max(1, maxRows - statsAxisRowCount(dimension) - BOARD_MARGIN_ROWS);

	return (
		<Box flexDirection="column" width={contentWidth}>
			<AxisRow
				label="View"
				values={DIMENSIONS}
				active={dimension}
				focused={focus === 0}
				tokens={tokens}
			/>
			<AxisRow
				label="Window"
				values={WINDOWS}
				active={windowIdx}
				focused={focus === 1}
				tokens={tokens}
			/>
			{entry !== null ?
				<EntryRow
					label={dimension === 1 ? "Project" : "Character"}
					entry={entry}
					focused={focus === 2}
					tokens={tokens}
				/>
			: dimension !== 0 ?
				<Text {...tokens.textMuted}>
					{"  "}No {dimension === 1 ? "projects" : "characters"} yet.
				</Text>
			:	null}
			{empty ?
				<EmptyNotice tokens={tokens} />
			:	<Box marginTop={1}>
					<ScrollBox
						width={contentWidth}
						height={boardRows}
						offsetX={offsetX}
						offsetY={offsetY}>
						<Box flexDirection="column">
							<Heatmap cells={heatmap} tokens={tokens} days={HEATMAP_DAYS} />
							<Sparkline values={sparkline} tokens={tokens} days={HEATMAP_DAYS} />
						</Box>
						<StatsGroups groups={view.groups} columns={gridCols} tokens={tokens} />
						<Box flexDirection="column" marginTop={1}>
							<WeekdaySplit weekday={weekday} weekend={weekend} tokens={tokens} />
							<CostBlock cost={cost} tokens={tokens} />
							<ModelBars models={models} tokens={tokens} />
						</Box>
					</ScrollBox>
				</Box>
			}
		</Box>
	);
}
