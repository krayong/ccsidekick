// The presentational wordmark. The solid faces carry the theme shimmer via two distinct code paths, NOT a
// moodShift toggle: the animated full-color path calls wordmarkColor(hues, x, y, w, h, nowMs) — a diagonal HSV-interpolated
// drift keyed to live nowMs on SHIMMER_PERIOD_MS, kept separate from the render figureColor so the wordmark's
// midtones stay saturated. The reduced-motion (full-color-frozen) path instead calls
// gradient(hues, WORDMARK_WIDTH) once and indexes it by column, so it is a static HORIZONTAL ramp (same color
// down each column, varying across columns) and ignores nowMs entirely. Under 16-color it is a single accent;
// under NO_COLOR it is bold-only. The box-drawing shadow edges are always dimmed (frameDim) so the wordmark
// reads raised. Holds no state; App owns the shimmer clock and passes nowMs in.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { gradient } from "../../render";
import { hexForXterm, type Capability, type TextStyle, type Tokens } from "../theme";

import { SOLID, WORDMARK, WORDMARK_WIDTH } from "./wordmark";
import { wordmarkColor } from "./wordmarkColor";

export { WORDMARK, WORDMARK_WIDTH } from "./wordmark";

interface LogoProps {
	readonly hues: readonly number[];
	readonly capability: Capability;
	readonly reducedMotion: boolean;
	readonly nowMs: number;
	readonly tokens: Tokens;
}

export function Logo({ hues, capability, reducedMotion, nowMs, tokens }: LogoProps): ReactElement {
	const w = WORDMARK_WIDTH;
	const h = WORDMARK.length;
	const frozen = capability === "full" && reducedMotion ? gradient(hues, w) : null;

	const solidStyle = (x: number, y: number): TextStyle => {
		if (capability === "none") return { bold: true };
		if (capability === "basic") return tokens.accent;
		const idx =
			frozen !== null ? (frozen[x] ?? hues[0] ?? 0) : wordmarkColor(hues, x, y, w, h, nowMs);
		return { color: hexForXterm(idx), bold: true };
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
								<Text key={key} {...solidStyle(x, y)}>
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
