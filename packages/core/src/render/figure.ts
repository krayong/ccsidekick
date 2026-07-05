// The figure-drop decision and the diagonal smoothstep shimmer gradient. Pure: the only time input is the `nowMs`
// the caller injects. The figure is a single static array of rows; mood never shifts a glyph, only its color. The
// gradient is glyph-stable: it only re-colors a cell, never shifts a character, so the figure cannot strobe. The
// gradient always drifts diagonally by wall-clock (the logo's base shimmer animation); mood_shift is independent
// and only layers a static per-mood tint on top.

import {
	FIGURE_COLS,
	GAP,
	MIN_RIGHT_WIDTH,
	PRESSURE_MOODS,
	SHIMMER_PERIOD_MS,
	type Mood,
	type RenderMood,
} from "../domain";

import { mix, moodTint, xtermToRgb, rgbToXterm } from "./color";

const baseMood = (mood: RenderMood): Mood =>
	(PRESSURE_MOODS as readonly string[]).includes(mood) ? "struggling" : (mood as Mood);

/** The figure renders only when `columns ≥ FIGURE_COLS + GAP + MIN_RIGHT_WIDTH` (i.e. ≥ 80); below that it is dropped. */
export const figureFits = (columns: number): boolean =>
	columns >= FIGURE_COLS + GAP + MIN_RIGHT_WIDTH;

// The figure's shimmer post-process tint is stronger than the accent shift (a full-figure wash reads better).
const STATIC_TINT = 0.35;

const frac = (x: number): number => x - Math.floor(x);
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * The diagonal, cyclic, smoothstep gradient color for a non-blank figure cell.
 * `(x,y)` is the cell's code-point column / row; `(w,h)` are the actual frame extents. The gradient always drifts
 * top-left → bottom-right on wall-clock (SHIMMER_PERIOD_MS); `moodShift` additionally layers a static per-mood
 * tint over that drift. Color only — never shifts a glyph.
 */
export const figureColor = (
	hues: readonly number[],
	x: number,
	y: number,
	w: number,
	h: number,
	mood: RenderMood,
	nowMs: number,
	moodShift: boolean,
): number => {
	const phase = frac(nowMs / SHIMMER_PERIOD_MS);
	const t = (x / Math.max(1, w - 1) + y / Math.max(1, h - 1)) / 2 + phase;
	const n = hues.length;
	const p = frac(t) * n;
	const i = Math.floor(p);
	const c = mix(
		xtermToRgb(hues[i % n] ?? 0),
		xtermToRgb(hues[(i + 1) % n] ?? 0),
		smoothstep(p - i),
	);
	return rgbToXterm(moodShift ? moodTint(c, baseMood(mood), STATIC_TINT) : c);
};
