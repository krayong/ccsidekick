// Core's public entry: the single surface that tooling outside the package (the pack-author skill scripts)
// imports through, instead of reaching into individual internal files. Core's own modules keep importing each
// other by path; this barrel exists only to give the package one public boundary. Keep it curated — export a
// symbol here only when an out-of-package consumer needs it.

export { FIGURE_COLS, MOODS, PRESSURE_MOODS, REACTION_CATEGORIES, STACKS, TIERS } from "./domain";
export type { PackJson } from "./domain";
export { PLACEHOLDER_TOKEN } from "./packs";
export { displayWidth, rgbToXterm, themeColorErrors, xtermToRgb } from "./render";
export { hexForXterm } from "./tui/theme";
