// Public barrel for render/. Re-exports exactly the symbols consumed by code outside this directory.
// layout.ts re-exports stripAnsi from strip — exported here only from ./strip to avoid TS2308.
// themeValidate.ts re-exports isVisibleXterm and rgbToHsvHue from color — exported here only from ./color.

// color
export type { Rgb } from "./color";
export {
	fg,
	fgBold,
	fgFaint,
	fgLink,
	gradient,
	isVisibleXterm,
	osc8,
	rgbToHsvHue,
	rgbToXterm,
	xtermToRgb,
} from "./color";

// figure
export { figureColor, figureFits } from "./figure";

// layout — stripAnsi is intentionally excluded; it comes from ./strip below
export type { LayoutInput } from "./layout";
export { layout } from "./layout";

// strip
export { displayWidth, padEndDisplay, stripAnsi, truncateAnsi } from "./strip";

// theme
export type { ResolvedTheme } from "./theme";
export {
	accentColor,
	applyMood,
	CHARACTER_THEME,
	helpfulStyle,
	iconFor,
	resolveTheme,
	signalColor,
	valueColor,
} from "./theme";

// themeValidate — isVisibleXterm and rgbToHsvHue intentionally excluded; they come from ./color above
export type { ThemeColors } from "./themeValidate";
export { themeColorErrors } from "./themeValidate";
