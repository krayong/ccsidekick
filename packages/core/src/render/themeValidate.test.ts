import { expect, test } from "bun:test";

import { isVisibleXterm, rgbToHsvHue, themeColorErrors } from "./themeValidate";

test("isVisibleXterm excludes system/greyscale and near-grey/too-dark cube indices", () => {
	expect(isVisibleXterm(16)).toBe(false); // system/black boundary
	expect(isVisibleXterm(232)).toBe(false); // greyscale ramp
	expect(isVisibleXterm(244)).toBe(false); // the old grey separator — now invalid
	expect(isVisibleXterm(59)).toBe(false); // (95,95,95) near-grey: chroma 0
	expect(isVisibleXterm(75)).toBe(true); // a vivid blue
	expect(isVisibleXterm(203)).toBe(true); // a vivid red
});

test("rgbToHsvHue returns the expected family hue", () => {
	expect(Math.round(rgbToHsvHue([255, 0, 0]))).toBe(0); // red
	expect(Math.round(rgbToHsvHue([0, 255, 0]))).toBe(120); // green
	expect(rgbToHsvHue([10, 10, 10])).toBe(0); // achromatic guard
});

test("themeColorErrors accepts a valid theme and flags every violation", () => {
	const good = {
		hues: [75, 147, 77, 222, 210],
		comment: [75, 147, 222],
		signals: { nominal: 77, caution: 214, critical: 203 },
		separator: 147,
	};
	expect(themeColorErrors(good, "houston")).toEqual([]);

	expect(themeColorErrors({ ...good, hues: [75, 147, 77] }, "x")).toContain(
		"x.hues must have 4..5 stops",
	);
	expect(themeColorErrors({ ...good, comment: [75] }, "x")).toContain(
		"x.comment must have 2..3 stops",
	);
	expect(themeColorErrors({ ...good, separator: 244 }, "x")).toContain(
		"x.separator (244) is not a visible color",
	);
	// signal family inversions
	expect(
		themeColorErrors({ ...good, signals: { ...good.signals, critical: 46 } }, "x"),
	).toContain("x.signals.critical (46) is not red-family");
	expect(
		themeColorErrors({ ...good, signals: { ...good.signals, nominal: 203 } }, "x"),
	).toContain("x.signals.nominal (203) is not green-family");
});
