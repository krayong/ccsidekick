// packages/core/src/tui/widgets/BarMeter.tsx
// A horizontal bar for a 0..1 ratio: a padded label, a filled accent segment over a dim frame track, and a
// trailing caption (the human-readable value). The ratio is clamped to 0..1 and a non-finite ratio reads empty.
// Presentational only; the Dashboard computes the ratio and caption.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { padEndDisplay } from "../../render";
import type { Tokens } from "../theme";

interface BarMeterProps {
	readonly label: string;
	readonly ratio: number;
	readonly caption: string;
	readonly tokens: Tokens;
	readonly width?: number;
	/** Overrides the fill's color (e.g. a per-model theme hue); omitted, the fill keeps `tokens.accent`. */
	readonly color?: string;
}

export function BarMeter({
	label,
	ratio,
	caption,
	tokens,
	width = 16,
	color,
}: BarMeterProps): ReactElement {
	const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
	const filled = Math.round(clamped * width);
	const empty = Math.max(0, width - filled);
	const fillStyle = { ...tokens.accent, ...(color !== undefined ? { color } : {}) };
	return (
		<Box>
			<Text {...tokens.text}>{padEndDisplay(`${label} `, 15)}</Text>
			<Text {...fillStyle}>{"█".repeat(filled)}</Text>
			<Text {...tokens.frameDim}>{"░".repeat(empty)}</Text>
			<Text {...tokens.textMuted}> {caption}</Text>
		</Box>
	);
}
