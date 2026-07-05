// packages/core/src/tui/widgets/Heatmap.tsx
// A 7-column activity heatmap over up to `days` per-day session counts (oldest first), 28 by default. Each cell
// is colored by a single-hue intensity ramp anchored at the theme's frameDim (no activity) and rising to a hue
// from the theme's data-hue ramp (busiest day): level 0 uses frameDim, levels 1-4 modulate that hue by dim ->
// plain -> bold, paired with a block-glyph ramp so intensity still reads at the NO_COLOR tier. Presentational
// only; the Dashboard passes the counts in.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import type { TextStyle, Tokens } from "../theme";

interface HeatmapProps {
	readonly cells: readonly number[];
	readonly tokens: Tokens;
	/** Day count the grid sizes to and the legend names. Defaults to 28 (4 rows of 7). */
	readonly days?: number;
}

const RAMP = ["·", "░", "▒", "▓", "█"] as const;

/** Map a session count to a 0..4 intensity level against the window max. Exported for unit tests. */
export function levelOf(sessions: number, max: number): number {
	if (sessions <= 0 || max <= 0) return 0;
	return Math.min(4, Math.max(1, Math.ceil((sessions / max) * 4)));
}

/** The style for an intensity level: 0 is frameDim; 1-4 ramp a theme data hue by dim -> plain -> bold. */
function levelStyle(level: number, tokens: Tokens): TextStyle {
	if (level <= 0) return tokens.frameDim;
	const color = tokens.dataHues[0] ?? tokens.accent.color;
	const base: TextStyle = color === undefined ? {} : { color };
	if (level === 1) return { ...base, dimColor: true };
	if (level >= 4) return { ...base, bold: true };
	return base;
}

export function Heatmap({ cells, tokens, days = 28 }: HeatmapProps): ReactElement {
	const data = cells.slice(0, days);
	const max = data.reduce((m, n) => Math.max(m, n), 0);
	const rows = Math.ceil(days / 7);
	const weeks: number[][] = [];
	for (let r = 0; r < rows; r++) weeks.push(data.slice(r * 7, r * 7 + 7));
	return (
		<Box flexDirection="column">
			{weeks.map((week, r) => (
				<Box key={`w-${String(r)}`}>
					{week.map((sessions, c) => {
						const level = levelOf(sessions, max);
						const glyph = RAMP[level] ?? "·";
						return (
							<Text
								key={`c-${String(r)}-${String(c)}`}
								{...levelStyle(level, tokens)}>
								{glyph}
								{glyph}
							</Text>
						);
					})}
				</Box>
			))}
			<Box>
				<Text {...tokens.textMuted}>less </Text>
				{RAMP.map((g, i) => (
					<Text key={`lg-${String(i)}`} {...levelStyle(i, tokens)}>
						{g}
					</Text>
				))}
				<Text {...tokens.textMuted}> more · {days}-day activity</Text>
			</Box>
		</Box>
	);
}
