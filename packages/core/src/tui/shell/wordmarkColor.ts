// Cleaner wordmark shimmer coloring, kept separate from the shared render `figureColor`. Interpolates between the
// theme's hue stops in HSV space along the shorter hue arc, so transitions stay saturated (no muddy brown/olive/
// teal midtones), then quantizes back to xterm-256. Pure: the color is a function of (stops, cell, extents, nowMs).

import { SHIMMER_PERIOD_MS } from "../../domain";
import { rgbToXterm, xtermToRgb } from "../../render";

type Rgb = readonly [number, number, number];
type Hsv = [number, number, number]; // h in [0,360), s and v in [0,1]

const rgbToHsv = ([r, g, b]: Rgb): Hsv => {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const mx = Math.max(rn, gn, bn);
	const mn = Math.min(rn, gn, bn);
	const d = mx - mn;
	let h = 0;
	if (d !== 0) {
		if (mx === rn) h = ((gn - bn) / d) % 6;
		else if (mx === gn) h = (bn - rn) / d + 2;
		else h = (rn - gn) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const s = mx === 0 ? 0 : d / mx;
	return [h, s, mx];
};

const hsvToRgb = ([h, s, v]: Hsv): [number, number, number] => {
	const c = v * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r = 0;
	let g = 0;
	let b = 0;
	if (hp < 1) [r, g, b] = [c, x, 0];
	else if (hp < 2) [r, g, b] = [x, c, 0];
	else if (hp < 3) [r, g, b] = [0, c, x];
	else if (hp < 4) [r, g, b] = [0, x, c];
	else if (hp < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const m = v - c;
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

// Interpolate hue the short way around the wheel so adjacent stops never sweep through the far side.
const lerpHue = (a: number, b: number, t: number): number => {
	let diff = b - a;
	if (diff > 180) diff -= 360;
	else if (diff < -180) diff += 360;
	let h = a + diff * t;
	if (h < 0) h += 360;
	else if (h >= 360) h -= 360;
	return h;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const frac = (x: number): number => x - Math.floor(x);
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * The diagonal, cyclic, HSV-interpolated shimmer color for a wordmark cell. `(x,y)` is the cell's column/row;
 * `(w,h)` are the figure extents; the phase drifts top-left → bottom-right on `SHIMMER_PERIOD_MS`.
 */
export const wordmarkColor = (
	stops: readonly number[],
	x: number,
	y: number,
	w: number,
	h: number,
	nowMs: number,
): number => {
	const phase = frac(nowMs / SHIMMER_PERIOD_MS);
	const t = (x / Math.max(1, w - 1) + y / Math.max(1, h - 1)) / 2 + phase;
	const n = stops.length;
	const p = frac(t) * n;
	const i = Math.floor(p);
	const f = smoothstep(p - i);
	const a = rgbToHsv(xtermToRgb(stops[i % n] ?? 0));
	const b = rgbToHsv(xtermToRgb(stops[(i + 1) % n] ?? 0));
	const hsv: Hsv = [lerpHue(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
	return rgbToXterm(hsvToRgb(hsv));
};
