// Theme resolution and the engine-owned line-solid coloring. A theme is data; every algorithm lives here, so
// packs stay pure data. Each of the three surfaces (statusline, logo, comment) resolves a name —
// per-surface override ?? config default name ?? "houston" — to a ThemeData, from the built-in catalog or an
// installed pack's `theme` block. Pure: no env, no clock (the figure shimmer's clock lives in render/figure).

import { THEMES, type ThemeData } from "../data";
import {
	PRESSURE_MOODS,
	type Mood,
	type RenderMood,
	type Severity,
	type SignalLevel,
	type WidgetId,
} from "../domain";
import type { Config } from "../sources";

import { moodTint, xtermToRgb, rgbToXterm } from "./color";

export interface ResolvedTheme {
	readonly statusline: {
		readonly hues: readonly number[];
		readonly signals: {
			readonly nominal: number;
			readonly caution: number;
			readonly critical: number;
		};
		readonly separator: number;
		/** Hue banding: `solid` paints one hue per line; `cycle` advances the hue per cell across the row. */
		readonly banding: "solid" | "cycle";
	};
	readonly logo: { readonly hues: readonly number[] };
	readonly comment: { readonly gradient: readonly number[] };
	readonly icons: Readonly<Record<string, string>>;
}

// Engine default glyphs per icon-bearing widget (the [theme.icons] config). Value-only fields carry "" and are
// inert. git_operation is a nested sub-table resolved per in-progress state, not a single glyph, so it is kept
// separate and is not a flat icon entry.
export const DEFAULT_ICONS: Readonly<Record<string, string>> = {
	dir: "📁",
	added_dirs: "📂",
	session_name: "🪧",
	git_branch: "🌿",
	git_hash: "🔖",
	git_tag: "🏷️",
	git_worktree: "🌳",
	git_changes: "",
	git_ahead_behind: "",
	git_status: "",
	git_conflict: "⚠️",
	git_stash: "🗄️",
	pr: "🔗",
	model: "",
	fast_mode: "⚡",
	thinking: "🧠",
	output_style: "✍️",
	agent: "🤖",
	context_usage: "📊",
	compactions: "🗜️",
	cost_chat: "🧾",
	cost_project: "🏗️",
	cost_total: "🏦",
	cost_burn: "📈",
	block_usage: "⏱️",
	weekly_usage: "📅",
	balance: "💳",
	pay_as_you_go: "💸",
	cache_hit: "🎯",
	token_burn: "🔥",
	session_duration: "⏳",
	todo: "📝",
};

/** The sentinel theme name that follows the active character: each surface resolving to it uses the persona's pack theme. */
export const CHARACTER_THEME = "character";

const nameFor = (
	config: Config,
	surface: "statusline" | "logo" | "comment",
	persona: string,
): string => {
	const override = config.theme[surface];
	const base =
		override !== undefined && override !== "" ? override
		: config.theme.name !== "" ? config.theme.name
		: "houston";
	// The sentinel makes a surface follow the active character: resolve it to the persona's own theme name,
	// which themeFor then looks up as a pack theme (falling through to houston when the pack ships none).
	return base === CHARACTER_THEME ? persona : base;
};

const themeFor = (name: string, lookupPackTheme: (name: string) => ThemeData | null): ThemeData =>
	(THEMES as Record<string, ThemeData>)[name] ?? lookupPackTheme(name) ?? THEMES.houston;

/**
 * Resolve the per-surface theme for this render. Each surface's name resolves independently
 * (per-surface override ?? config.theme.name ?? "houston"); a name hits the built-in catalog first, then an
 * installed pack's `theme` block (by pack name), then the guaranteed-present `THEMES.houston`. No pack argument:
 * the emblem is threaded separately into LayoutInput.emblem by cli/render.
 */
export const resolveTheme = (
	config: Config,
	lookupPackTheme: (name: string) => ThemeData | null,
	persona = "",
): ResolvedTheme => {
	const statusline = themeFor(nameFor(config, "statusline", persona), lookupPackTheme);
	const logo = themeFor(nameFor(config, "logo", persona), lookupPackTheme);
	const comment = themeFor(nameFor(config, "comment", persona), lookupPackTheme);
	return {
		statusline: {
			hues: statusline.hues,
			signals: statusline.signals,
			separator: statusline.separator,
			banding: config.theme.banding,
		},
		logo: { hues: logo.hues },
		comment: { gradient: comment.comment },
		icons: { ...DEFAULT_ICONS, ...config.theme.icons },
	};
};

type StatuslineTheme = ResolvedTheme["statusline"];

const band = (hues: readonly number[], lineIdx: number): number => {
	const len = hues.length;
	return hues[((lineIdx % len) + len) % len] ?? hues[0] ?? 0;
};

/**
 * The accent (icon/label) hue for a cell. `solid` banding gives every cell on a line the same `hues[lineIdx]`;
 * `cycle` banding advances the hue per cell, `hues[lineIdx + cellIdx]`, so each row is a rainbow that shifts one
 * stop per line. `cellIdx` is ignored under `solid`.
 */
export const accentColor = (s: StatuslineTheme, lineIdx: number, cellIdx = 0): number =>
	band(s.hues, s.banding === "cycle" ? lineIdx + cellIdx : lineIdx);

/** The value-segment color: same hue as the accent, under either banding. */
export const valueColor = (s: StatuslineTheme, lineIdx: number, cellIdx = 0): number =>
	accentColor(s, lineIdx, cellIdx);

/** The theme color for a fixed, engine-owned threshold band. */
export const signalColor = (s: StatuslineTheme, level: SignalLevel): number => s.signals[level];

export const iconFor = (field: WidgetId, theme: ResolvedTheme, config: Config): string => {
	const override = config.theme.icons[field];
	if (override !== undefined) return override;
	return theme.icons[field] ?? "";
};

const baseMood = (mood: RenderMood): Mood =>
	(PRESSURE_MOODS as readonly string[]).includes(mood) ? "struggling" : (mood as Mood);

// The accent/comment mood shift is subtler than the figure's full-figure wash.
const STATIC_TINT = 0.25;

/**
 * The static accent/comment-gradient mood tint: idle/busy none, happy warm, struggling toward
 * caution, recovery cool; pressure moods reuse struggling. Never applied to a signal color (returned unchanged),
 * never to a value, never shifts a glyph. The caller gates this on `config.theme.mood_shift`.
 */
export const applyMood = (color: number, mood: RenderMood, isSignal: boolean): number => {
	if (isSignal) return color;
	const base = baseMood(mood);
	if (base === "idle" || base === "busy") return color;
	return rgbToXterm(moodTint(xtermToRgb(color), base, STATIC_TINT));
};

// Engine-fixed, theme-independent, mood-exempt helpful-comment styling. The severity emoji are
// double-width (strip.ts) and carry the urgency; the text itself is one fixed bold bright-white color (231) for
// every severity, painted statically (no brightness animation).
const HELPFUL_COLOR = 231; // bold bright white
const HELPFUL_STYLE: Readonly<Record<Severity, { emoji: string; color: number }>> = {
	critical: { emoji: "🚨", color: HELPFUL_COLOR },
	high: { emoji: "⚠️", color: HELPFUL_COLOR },
	medium: { emoji: "💡", color: HELPFUL_COLOR },
	low: { emoji: "💬", color: HELPFUL_COLOR },
	none: { emoji: "", color: HELPFUL_COLOR },
};

/** The fixed emoji + bold bright-white color for a helpful-comment severity (theme- and mood-exempt). */
export const helpfulStyle = (severity: Severity): { emoji: string; color: number } =>
	HELPFUL_STYLE[severity];
