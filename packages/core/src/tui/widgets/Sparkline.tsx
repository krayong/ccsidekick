// packages/core/src/tui/widgets/Sparkline.tsx
// A one-line spark over up to `days` per-day session counts (oldest first), 28 by default, drawn in a hue from
// the theme's data-hue ramp. Each value maps to one of eight block heights relative to the series max; zeros
// floor to the shortest bar. Presentational only.

import { Text } from "ink";
import type { ReactElement } from "react";

import type { TextStyle, Tokens } from "../theme";

interface SparklineProps {
	readonly values: readonly number[];
	readonly tokens: Tokens;
	/** Day count the series slices to. Defaults to 28. */
	readonly days?: number;
}

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const FLOOR = BARS[0];

export function Sparkline({ values, tokens, days = 28 }: SparklineProps): ReactElement {
	const data = values.slice(0, days);
	const max = data.reduce((m, n) => Math.max(m, n), 0);
	const spark = data
		.map((v) => {
			if (max <= 0 || v <= 0) return FLOOR;
			const idx = Math.min(
				BARS.length - 1,
				Math.max(0, Math.ceil((v / max) * BARS.length) - 1),
			);
			return BARS[idx] ?? FLOOR;
		})
		.join("");
	const hue = tokens.dataHues[1] ?? tokens.dataHues[0];
	const style: TextStyle = hue === undefined ? tokens.accent : { ...tokens.accent, color: hue };
	return <Text {...style}>{spark}</Text>;
}
