// Theme-derived semantic tokens. Every component reads tokens, never a raw color. `resolveTokens` maps the
// active theme's xterm-256 indices to Ink-ready styles, degrading across the three capability tiers: `full`
// emits a hex (Ink downsamples per terminal), `basic` snaps to a named ANSI color so the terminal owns the
// shade, and `none` drops color and carries meaning through weight and dim alone.

import type { ThemeData } from "../../data";
import { xtermToRgb } from "../../render";

import type { Capability } from "./capability";

/** A spreadable subset of Ink `Text` props. `resolveTokens` never sets a key to `undefined`; it omits it. */
export interface TextStyle {
	readonly color?: string;
	readonly backgroundColor?: string;
	readonly bold?: boolean;
	readonly dimColor?: boolean;
	readonly inverse?: boolean;
}

export interface Tokens {
	readonly capability: Capability;
	readonly accent: TextStyle;
	readonly separator: TextStyle;
	readonly nominal: TextStyle;
	readonly caution: TextStyle;
	readonly critical: TextStyle;
	readonly frame: TextStyle;
	readonly frameDim: TextStyle;
	readonly text: TextStyle;
	readonly textMuted: TextStyle;
	readonly dataHues: readonly string[];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** An xterm-256 index as an Ink-ready `#rrggbb` string. */
export function hexForXterm(index: number): string {
	const [r, g, b] = xtermToRgb(index);
	return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// Ink's 16 named colors, in xterm index order 0..15.
const ANSI16_NAMES = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"gray",
	"redBright",
	"greenBright",
	"yellowBright",
	"blueBright",
	"magentaBright",
	"cyanBright",
	"whiteBright",
] as const;

/** The nearest of Ink's 16 named colors to an xterm-256 index, by squared RGB distance. */
export function nearestAnsi16(index: number): string {
	const [r, g, b] = xtermToRgb(index);
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < 16; i++) {
		const [cr, cg, cb] = xtermToRgb(i);
		const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return ANSI16_NAMES[best] ?? "white";
}

const colorStyle = (index: number, cap: Capability, extra: TextStyle = {}): TextStyle =>
	cap === "none" ?
		{ ...extra }
	:	{ color: cap === "full" ? hexForXterm(index) : nearestAnsi16(index), ...extra };

export function resolveTokens(theme: ThemeData, cap: Capability): Tokens {
	const accentIndex = theme.hues[3] ?? theme.hues[0] ?? 0;
	return {
		capability: cap,
		accent: colorStyle(accentIndex, cap, { bold: true }),
		separator: cap === "none" ? { dimColor: true } : colorStyle(theme.separator, cap),
		nominal: colorStyle(theme.signals.nominal, cap),
		caution: colorStyle(theme.signals.caution, cap),
		critical: colorStyle(theme.signals.critical, cap, { bold: true }),
		frame: cap === "none" ? {} : { color: "gray" },
		frameDim: cap === "none" ? { dimColor: true } : { color: "gray", dimColor: true },
		text: {},
		textMuted: { dimColor: true },
		dataHues:
			cap === "none" ?
				[]
			:	theme.hues.map((h) => (cap === "full" ? hexForXterm(h) : nearestAnsi16(h))),
	};
}
