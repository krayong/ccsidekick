// xterm-256 palette, RGB gradient interpolation, and ANSI SGR wrapping. Pure: all TTY/NO_COLOR decisions come
// from the injected TermContext, never from env. One curated 256-color palette renders everywhere; there is no
// truecolor path. NO_COLOR or a non-TTY strips every escape to plain text.

import { THEME_CHROMA_MIN, THEME_MAXCH_MIN, type Mood, type TermContext } from "../domain";

export type Rgb = readonly [number, number, number];

// The 16 base ANSI colors (xterm defaults). Indices 0-15.
const BASE16: readonly Rgb[] = [
	[0x00, 0x00, 0x00],
	[0x80, 0x00, 0x00],
	[0x00, 0x80, 0x00],
	[0x80, 0x80, 0x00],
	[0x00, 0x00, 0x80],
	[0x80, 0x00, 0x80],
	[0x00, 0x80, 0x80],
	[0xc0, 0xc0, 0xc0],
	[0x80, 0x80, 0x80],
	[0xff, 0x00, 0x00],
	[0x00, 0xff, 0x00],
	[0xff, 0xff, 0x00],
	[0x00, 0x00, 0xff],
	[0xff, 0x00, 0xff],
	[0x00, 0xff, 0xff],
	[0xff, 0xff, 0xff],
];

// The 6 channel levels of the 6×6×6 color cube (indices 16-231).
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** Decode an xterm-256 index to its [r,g,b] (16 base + 6×6×6 cube + 24-step grayscale ramp). */
export const xtermToRgb = (index: number): Rgb => {
	const i = clampByte(index);
	if (i < 16) return BASE16[i] ?? [0, 0, 0];
	if (i < 232) {
		const n = i - 16;
		const r = CUBE_LEVELS[Math.floor(n / 36) % 6] ?? 0;
		const g = CUBE_LEVELS[Math.floor(n / 6) % 6] ?? 0;
		const b = CUBE_LEVELS[n % 6] ?? 0;
		return [r, g, b];
	}
	const gray = (i - 232) * 10 + 8;
	return [gray, gray, gray];
};

/**
 * Quantize an [r,g,b] to the truly nearest xterm-256 index by Euclidean distance over the renderable palette
 * (the 6×6×6 cube and grayscale ramp, indices 16-255). A literal nearest search means any exact palette color
 * round-trips to its own index; the base-16 colors are excluded because their actual shade is terminal-profile
 * dependent and overlaps the cube.
 */
// Called once per figure cell per render; the input is 8-bit-per-channel, so memoize the nearest-index search by
// a 24-bit quantized key. Pure: the result is a function of the (rounded) rgb, cached across ticks.
const xtermQuantCache = new Map<number, number>();

export const rgbToXterm = (rgb: Rgb): number => {
	const r = clampByte(rgb[0]);
	const g = clampByte(rgb[1]);
	const b = clampByte(rgb[2]);
	const key = (r << 16) | (g << 8) | b;
	const cached = xtermQuantCache.get(key);
	if (cached !== undefined) return cached;
	let best = 16;
	let bestDist = Infinity;
	for (let i = 16; i < 256; i++) {
		const [cr, cg, cb] = xtermToRgb(i);
		const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	xtermQuantCache.set(key, best);
	return best;
};

/** A "visible on a dark terminal" xterm index: not system/greyscale, and within the cube vivid enough to read. */
export const isVisibleXterm = (index: number): boolean => {
	if (!Number.isInteger(index) || index <= 16 || index >= 232) return false;
	const [r, g, b] = xtermToRgb(index);
	const chroma = Math.max(r, g, b) - Math.min(r, g, b);
	return chroma >= THEME_CHROMA_MIN && Math.max(r, g, b) >= THEME_MAXCH_MIN;
};

/** The HSV hue (degrees 0..360) of an [r,g,b]; 0 for an achromatic color. */
export const rgbToHsvHue = (rgb: Rgb): number => {
	const r = rgb[0] / 255;
	const g = rgb[1] / 255;
	const b = rgb[2] / 255;
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	const d = mx - mn;
	if (d === 0) return 0;
	let h: number;
	if (mx === r) h = ((g - b) / d) % 6;
	else if (mx === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h *= 60;
	return h < 0 ? h + 360 : h;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Interpolate a gradient of `n` xterm-256 indices across the given stops, interpolating in RGB between bracketing
 * stops and quantizing each result back to xterm-256. Single-stop safe: one stop ⇒ all `n` equal that stop;
 * n === 1 ⇒ [stops[0]].
 */
export const gradient = (stops: readonly number[], n: number): number[] => {
	if (n < 1) return [];
	const first = stops[0];
	if (first === undefined) return [];
	if (n === 1) return [first];
	if (stops.length === 1) return Array.from({ length: n }, () => first);

	const segments = stops.length - 1;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const pos = (i / (n - 1)) * segments;
		const lo = Math.min(Math.floor(pos), segments - 1);
		const frac = pos - lo;
		const a = xtermToRgb(stops[lo] ?? first);
		const c = xtermToRgb(stops[lo + 1] ?? first);
		out.push(
			rgbToXterm([lerp(a[0], c[0], frac), lerp(a[1], c[1], frac), lerp(a[2], c[2], frac)]),
		);
	}
	return out;
};

// ── Static mood tint, shared by the figure shimmer and the accent/comment shift ───────────────────────────────
// Reference colors layered over a base color per mood: happy → warm, struggling → caution, recovery → cool.
const WARM: Rgb = [255, 170, 60];
const COOL: Rgb = [120, 200, 255];
const CAUTION_TINT: Rgb = xtermToRgb(214);

/** Linear RGB interpolation `a → b` at `t`. */
export const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t,
];

/**
 * Layer the static per-mood tint over `rgb` at `strength` (happy warm, struggling caution, recovery cool;
 * idle/busy add nothing). `mood` is the collapsed base mood. Color only — never shifts a glyph.
 */
export const moodTint = (rgb: Rgb, mood: Mood, strength: number): [number, number, number] => {
	switch (mood) {
		case "happy":
			return mix(rgb, WARM, strength);
		case "struggling":
			return mix(rgb, CAUTION_TINT, strength);
		case "recovery":
			return mix(rgb, COOL, strength);
		case "idle":
		case "busy":
			return [rgb[0], rgb[1], rgb[2]];
	}
};

/** Wrap `text` in a 256-color foreground SGR, or return it plain under NO_COLOR / a non-TTY. */
export const fg = (index: number, text: string, term: TermContext): string =>
	term.noColor || !term.isTTY ? text : `\x1b[38;5;${index}m${text}\x1b[0m`;

/** Like `fg`, but bold (SGR `1`). Plain text under NO_COLOR / a non-TTY. */
export const fgBold = (index: number, text: string, term: TermContext): string =>
	term.noColor || !term.isTTY ? text : `\x1b[1;38;5;${index}m${text}\x1b[0m`;

/** Like `fg`, but faint (SGR `2`) — a static dim, never a blink. Plain text under NO_COLOR / a non-TTY. */
export const fgFaint = (index: number, text: string, term: TermContext): string =>
	term.noColor || !term.isTTY ? text : `\x1b[2;38;5;${index}m${text}\x1b[0m`;

/**
 * Like `fg`, but with a dotted underline (SGR `4:4`) under the color — the clickable-link affordance for an
 * OSC 8 hyperlink segment. Plain text under NO_COLOR / a non-TTY.
 */
export const fgLink = (index: number, text: string, term: TermContext): string =>
	term.noColor || !term.isTTY ? text : `\x1b[4:4;38;5;${index}m${text}\x1b[0m`;

/**
 * Wrap `body` (already colorized) in an OSC 8 terminal hyperlink to `url`. Returns `body` unchanged under
 * NO_COLOR / a non-TTY, or when the URL is empty after sanitization. The URL is stripped of every C0/C1 control
 * byte (incl. ESC and the BEL terminator) so an externally-sourced URL cannot break out of the sequence — the
 * renderer stays the only source of escapes.
 */
export const osc8 = (url: string, body: string, term: TermContext): string => {
	if (term.noColor || !term.isTTY) return body;
	// eslint-disable-next-line no-control-regex -- intentionally strips every C0/C1 control byte (incl. ESC/BEL) so a URL cannot break out of the OSC 8 sequence
	const safe = url.replace(/[\x00-\x1f\x7f-\x9f]/gu, "");
	return safe === "" ? body : `\x1b]8;;${safe}\x07${body}\x1b]8;;\x07`;
};
