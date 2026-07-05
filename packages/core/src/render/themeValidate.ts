// The single source of the theme-color invariants: bounds, visibility (no grey / no near-black),
// vivid comment stops, and signal hue families. Shared by the built-in catalog test, the pack validator, and
// lint, so a built-in entry and a pack `theme` block are held to one rule set.

import { SIGNAL_HUE_RANGES } from "../domain";

import { isVisibleXterm, rgbToHsvHue, xtermToRgb } from "./color";

export { isVisibleXterm, rgbToHsvHue };

export interface ThemeColors {
	readonly hues: readonly number[];
	readonly comment: readonly number[];
	readonly signals: {
		readonly nominal: number;
		readonly caution: number;
		readonly critical: number;
	};
	readonly separator: number;
}

const hueOf = (index: number): number => rgbToHsvHue(xtermToRgb(index));

const familyOk = (index: number, level: keyof ThemeColors["signals"]): boolean => {
	const h = hueOf(index);
	if (level === "critical")
		return h <= SIGNAL_HUE_RANGES.critical.wrapMax || h >= SIGNAL_HUE_RANGES.critical.wrapMin;
	const range = SIGNAL_HUE_RANGES[level];
	return h >= range.min && h <= range.max;
};

/** Every §2 violation in a theme's colors, as human-readable messages prefixed by `label` (empty ⇒ valid). */
export const themeColorErrors = (t: ThemeColors, label: string): string[] => {
	const errors: string[] = [];
	if (t.hues.length < 4 || t.hues.length > 5) errors.push(`${label}.hues must have 4..5 stops`);
	if (t.comment.length < 2 || t.comment.length > 3)
		errors.push(`${label}.comment must have 2..3 stops`);
	t.hues.forEach((h, i) => {
		if (!isVisibleXterm(h))
			errors.push(`${label}.hues[${String(i)}] (${String(h)}) is not a visible color`);
	});
	t.comment.forEach((c, i) => {
		if (!isVisibleXterm(c))
			errors.push(`${label}.comment[${String(i)}] (${String(c)}) is not a visible color`);
	});
	if (!isVisibleXterm(t.separator))
		errors.push(`${label}.separator (${String(t.separator)}) is not a visible color`);
	for (const level of ["nominal", "caution", "critical"] as const) {
		const v = t.signals[level];
		if (!isVisibleXterm(v)) {
			errors.push(`${label}.signals.${level} (${String(v)}) is not a visible color`);
			continue;
		}
		const fam =
			level === "nominal" ? "green"
			: level === "caution" ? "amber"
			: "red";
		if (!familyOk(v, level))
			errors.push(`${label}.signals.${level} (${String(v)}) is not ${fam}-family`);
	}
	return errors;
};
