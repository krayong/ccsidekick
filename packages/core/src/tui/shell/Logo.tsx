// The presentational wordmark. The solid faces carry a static theme gradient: `gradient(hues, WORDMARK_WIDTH)`
// computed once and indexed by column, a horizontal ramp (same color down each column, varying across columns).
// It is intentionally NOT animated — a per-frame recolor forces Ink to erase-then-redraw the whole wordmark box,
// which flickers on terminals without double-buffering (iTerm2, Terminal.app). Under 16-color it is a single
// accent; under NO_COLOR it is bold-only. The box-drawing shadow edges are always dimmed (frameDim) so the
// wordmark reads raised. Holds no state and no clock.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { gradient, rgbToXterm, xtermToRgb } from "../../render";
import { hexForXterm, type Capability, type TextStyle, type Tokens } from "../theme";

import { SOLID, WORDMARK, WORDMARK_WIDTH } from "./wordmark";

export { WORDMARK, WORDMARK_WIDTH } from "./wordmark";

interface LogoProps {
	readonly hues: readonly number[];
	readonly capability: Capability;
	readonly tokens: Tokens;
}

// Push a color to full brightness while keeping its hue: scale its channels so the brightest one hits 255. The
// wordmark stays vivid whatever theme it inherits — no dim or muddy gradient stops, even from a dark palette.
function brighten(index: number): number {
	const [r, g, b] = xtermToRgb(index);
	const mx = Math.max(r, g, b, 1);
	const scale = 255 / mx;
	return rgbToXterm([r * scale, g * scale, b * scale]);
}

export function Logo({ hues, capability, tokens }: LogoProps): ReactElement {
	const ramp = capability === "full" ? gradient(hues, WORDMARK_WIDTH).map(brighten) : null;

	const solidStyle = (x: number): TextStyle => {
		if (capability === "none") return { bold: true };
		if (capability === "basic") return tokens.accent;
		return { color: hexForXterm(ramp?.[x] ?? brighten(hues[0] ?? 0)), bold: true };
	};

	return (
		<Box flexDirection="column">
			{WORDMARK.map((row, y) => (
				<Text key={`logo-${String(y)}`}>
					{Array.from(row, (ch, x) => {
						const key = `c-${String(x)}`;
						if (ch === " ") return <Text key={key}> </Text>;
						if (ch === SOLID)
							return (
								<Text key={key} {...solidStyle(x)}>
									{ch}
								</Text>
							);
						return (
							<Text key={key} {...tokens.frameDim}>
								{ch}
							</Text>
						);
					})}
				</Text>
			))}
		</Box>
	);
}
