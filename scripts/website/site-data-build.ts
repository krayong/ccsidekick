#!/usr/bin/env bun
// The single source of truth for the landing page's data payload. buildSiteData() derives the character wall,
// the per-character theme cards, the theme catalog, the widget cards, and every count straight from the packs
// (pack.json) plus the engine's exported constants (DEFAULT_ICONS / DEFAULT_CONFIG / THEMES / PACKS /
// WIDGET_GROUPS). Both `site:data` (which writes website/data.js) and `site:drift` (which recomputes and
// deep-compares the committed data.js against this) call it, so the guard checks exactly what the writer emits —
// a colour, label, sample, emblem, or ordering change can't slip past drift the way a bare count/name check would.
// Build/CI-time only (Bun APIs are fine here).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { THEMES, type ThemeData } from "../../packages/core/src/data/themes";
import { PACKS } from "../../packages/core/src/packs/registry";
import { DEFAULT_ICONS } from "../../packages/core/src/render/theme";
import { DEFAULT_CONFIG } from "../../packages/core/src/sources/config";
import { WIDGET_GROUPS } from "../../packages/core/src/tui/sections/widgetGroups";

import { palette, paletteHex } from "./xterm-palette";

const root = join(import.meta.dir, "..", "..");
const packsDir = join(root, "packages", "packs");

// a theme's palette, resolved to hex, for the site's theme cards (name-only, in-context statusline
// preview). Shape is shared by pack themes (pack.json) and catalog themes (data/themes.ts).
interface ThemeSrc {
	hues?: readonly number[];
	comment?: readonly number[];
	signals?: { nominal?: number; caution?: number; critical?: number };
	separator?: number;
}
function themeColors(src: ThemeSrc) {
	const sig = src.signals ?? {};
	return {
		bg: "#0d1117", // the terminal bg is constant; the theme colors the content
		hues: (src.hues ?? []).map(paletteHex),
		fg: paletteHex(src.comment?.[0] ?? src.hues?.[0]),
		ok: paletteHex(sig.nominal),
		warn: paletteHex(sig.caution),
		crit: paletteHex(sig.critical),
		sep: paletteHex(src.separator),
	};
}

interface PackJson {
	name: string;
	displayName: string;
	emblem: string;
	theme?: ThemeSrc;
}

// friendly label + sample value per widget, for the site's Widgets cards. Icons are the ENGINE's own
// DEFAULT_ICONS (source of truth), so the site never shows an icon the real status line wouldn't; several
// fields (model, git_changes, …) intentionally have no icon and come back "" so the site omits the glyph.
// Labels/samples are site presentation copy (the engine has no per-widget sample value to reuse); a new widget
// with no entry here gets a titleCase label and an empty sample, which site:drift flags rather than shipping.
const WIDGET_META: Record<string, { label: string; sample: string }> = {
	dir: { label: "Directory", sample: "~/dev/ccsidekick" },
	added_dirs: { label: "Added Dirs", sample: "+2 dirs" },
	session_name: { label: "Session Name", sample: "feat-widgets" },
	git_branch: { label: "Git Branch", sample: "feat/widget-layer" },
	git_hash: { label: "Git Hash", sample: "a1b2c3d" },
	git_tag: { label: "Git Tag", sample: "v1.4.0" },
	git_worktree: { label: "Git Worktree", sample: "wt: review" },
	git_changes: { label: "Git Changes", sample: "+32 2 files" },
	git_ahead_behind: { label: "Git Ahead & Behind", sample: "↑1 ↓0" },
	git_status: { label: "Git Status", sample: "(+1 !1 ?1)" },
	git_conflict: { label: "Git Conflict", sample: "conflict" },
	git_operation: { label: "Git Operation", sample: "rebase 2/5" },
	git_stash: { label: "Git Stash", sample: "2 stashed" },
	pr: { label: "Pull Request", sample: "PR #42 · approved" },
	model: { label: "Model", sample: "Opus 4.8 (1M) ✦ high" },
	fast_mode: { label: "Fast Mode", sample: "Fast" },
	thinking: { label: "Thinking", sample: "Thinking…" },
	output_style: { label: "Output Style", sample: "Style: concise" },
	agent: { label: "Agent", sample: "Agent: explore" },
	context_usage: { label: "Context Usage", sample: "43% (430k/1M)" },
	compactions: { label: "Compactions", sample: "2" },
	cost_chat: { label: "Chat Cost", sample: "$0.48" },
	cost_project: { label: "Project Cost", sample: "$1.18" },
	cost_total: { label: "Total Cost", sample: "$1.58" },
	cost_burn: { label: "Cost Burn", sample: "$4.20/h" },
	block_usage: { label: "Block Usage", sample: "86% (2h13m left)" },
	weekly_usage: { label: "Weekly Usage", sample: "63% (3d4h left)" },
	balance: { label: "Balance", sample: "$12.50" },
	pay_as_you_go: { label: "Cost / Limit", sample: "$3.10 / $20" },
	cache_hit: { label: "Cache Hit", sample: "78%" },
	token_burn: { label: "Token Burn", sample: "12k/min" },
	session_duration: { label: "Chat Duration", sample: "1h 24m" },
	todo: { label: "Todo", sample: "3/7 done" },
};
const titleCase = (id: string): string =>
	id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// signal color per widget, mirroring how the value renders in the status line
// (ok = nominal green, warn = caution amber, crit = critical coral, acc = accent blue; else muted).
const SIG: Record<string, "ok" | "warn" | "crit" | "acc"> = {
	dir: "acc",
	thinking: "acc",
	weekly_usage: "acc",
	todo: "acc",
	pr: "ok",
	cost_chat: "ok",
	cost_project: "ok",
	cost_total: "ok",
	balance: "ok",
	cache_hit: "ok",
	fast_mode: "warn",
	context_usage: "warn",
	cost_burn: "warn",
	token_burn: "warn",
	git_operation: "warn",
	git_conflict: "crit",
	block_usage: "crit",
};

// The character wall's display order (and the character-theme cards'). This is the authoritative roster order:
// EVERY pack must be listed here — a pack missing from ORDER fails site:drift (add the new pack to this list).
export const ORDER = [
	"spiderman",
	"batman",
	"barbie",
	"iron-man",
	"ben10",
	"hello-kitty",
	"shinchan",
	"james-bond",
	"pikachu",
	"gandalf",
	"naruto",
	"superman",
	"joker",
	"darth-vader",
	"harry-potter",
	"deadpool",
	"sherlock-holmes",
	"yoda",
];
const orderIdx = (n: string): number => {
	const i = ORDER.indexOf(n);
	return i < 0 ? ORDER.length : i;
};

/** Compute the full window.__CCSK payload from the packs and the engine's exported constants. */
export function buildSiteData() {
	const packs: PackJson[] = readdirSync(packsDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map(
			(e) =>
				JSON.parse(readFileSync(join(packsDir, e.name, "pack.json"), "utf8")) as PackJson,
		);
	// each pack's own theme, keyed by pack name, for the character-theme cards
	const packThemes = new Map<string, ThemeSrc>(packs.map((p) => [p.name, p.theme ?? {}]));

	const characters = packs.map((p) => {
		const th = p.theme ?? {};
		return {
			name: p.name,
			// spiderman's pack displayName is hyphenated ("Spider-Man"); the site wall uses the compact form
			display: p.name === "spiderman" ? "Spiderman" : p.displayName,
			emblem: p.emblem,
			color: paletteHex(th.hues?.[0] ?? th.separator), // dominant theme color, drives the wall card accent
		};
	});

	// pretty display names for catalog themes come straight off the engine's THEMES entries (so the site shows
	// "Shades of Purple", not "shadesOfPurple"). Character themes register under a pack name and take the
	// character's display name instead.
	const catalogThemes = new Map<string, ThemeData>(Object.entries(THEMES));
	const packNames = new Set<string>(PACKS);
	// every selectable theme except the Match-Character sentinel: the catalog themes then each pack's own theme
	// (registered under the pack name), mirroring the engine's `themeNames()` order minus "character".
	const themes = [...Object.keys(THEMES), ...PACKS].map((name) => {
		const character = packNames.has(name);
		const display =
			character ?
				(characters.find((c) => c.name === name)?.display ?? name)
			:	(catalogThemes.get(name)?.displayName ?? name);
		const src: ThemeSrc =
			character ? (packThemes.get(name) ?? {}) : (catalogThemes.get(name) ?? {});
		return { name, display, character, ...themeColors(src) };
	});
	characters.sort((a, b) => orderIdx(a.name) - orderIdx(b.name) || a.name.localeCompare(b.name));

	// order the theme catalog the way the site browses it: generic themes in catalog order, then each
	// pack's own theme in the character wall's order, so both subtabs read consistently.
	const orderedThemes = [
		...themes.filter((t) => !t.character),
		...themes.filter((t) => t.character).sort((a, b) => orderIdx(a.name) - orderIdx(b.name)),
	];

	const icons: Record<string, string> = DEFAULT_ICONS;
	const widgets = Object.keys(DEFAULT_CONFIG.statusline.widgets).map((id) => {
		const m = WIDGET_META[id];
		return {
			id,
			icon: icons[id] ?? "",
			label: m?.label ?? titleCase(id),
			sample: m?.sample ?? "",
			sig: SIG[id] ?? "",
		};
	});
	const counts = {
		characters: characters.length,
		themes: themes.length,
		widgets: widgets.length,
	};
	// the engine's default-on widget set and its widget taxonomy, so the configurator's initial state and its
	// group subtabs come from core (DEFAULT_CONFIG + WIDGET_GROUPS) instead of a hand-mirrored copy in index.html.
	const defaults = Object.entries(DEFAULT_CONFIG.statusline.widgets)
		.filter(([, on]) => on)
		.map(([id]) => id);
	const groups = WIDGET_GROUPS.filter((g) => g.widgets.length > 0).map((g) => ({
		name: g.name,
		widgets: [...g.widgets],
	}));
	// the full xterm-256 palette (index -> hex), so the in-browser ANSI->HTML converter reads it from here
	// instead of re-implementing the palette (single source: xterm-palette.ts).
	const ansiPalette = Array.from({ length: 256 }, (_, i) => palette(i));

	return {
		counts,
		characters,
		themes: orderedThemes,
		widgets,
		defaults,
		groups,
		palette: ansiPalette,
	};
}
