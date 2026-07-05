import { parse } from "smol-toml";

import type { WidgetId } from "../domain";

import { defaultCurrency } from "./locale";

export interface Config {
	readonly schema_version: number;
	readonly character: {
		readonly enabled: boolean;
		readonly mode: "fixed" | "random";
		readonly name: string;
		readonly roster: readonly string[];
	};
	readonly comments: {
		readonly enabled: boolean;
	};
	readonly helpful: {
		readonly enabled: boolean;
		readonly min_severity: "low" | "medium" | "high" | "critical";
	};
	readonly line: {
		readonly currency: string;
		readonly budget?: number;
		readonly widgets: Readonly<Record<WidgetId, boolean>>;
	};
	// theme: a default `name` plus optional per-surface overrides; unknown keys (legacy `mode`/`separator`) are ignored.
	readonly theme: {
		readonly name: string; // default theme for all three surfaces
		readonly statusline?: string; // optional per-surface override
		readonly logo?: string; // optional per-surface override
		readonly comment?: string; // optional per-surface override (a pack name is valid)
		readonly banding: "solid" | "cycle"; // statusline hue banding: one hue per line, or cycle hues across cells
		readonly mood_shift: boolean;
		readonly icons: Readonly<Record<string, string>>;
	};
	readonly network: {
		readonly fx_refresh: boolean;
		readonly usage_fetch: boolean;
		readonly balance_path: string;
	};
}

const DEFAULT_WIDGETS: Readonly<Record<WidgetId, boolean>> = {
	dir: true,
	added_dirs: false,
	session_name: false,
	git_branch: true,
	git_hash: true,
	git_tag: true,
	git_worktree: true,
	git_changes: true,
	git_ahead_behind: true,
	git_status: true,
	git_conflict: true,
	git_operation: true,
	git_stash: true,
	pr: true,
	model: true,
	fast_mode: true,
	thinking: false,
	output_style: true,
	agent: false,
	context_usage: true,
	compactions: false,
	cost_chat: true,
	cost_project: true,
	cost_total: true,
	cost_burn: false,
	block_usage: true,
	weekly_usage: true,
	balance: true,
	pay_as_you_go: true,
	cache_hit: false,
	token_burn: false,
	session_duration: false,
	todo: false,
};

export const DEFAULT_CONFIG: Config = {
	schema_version: 1,
	character: { enabled: true, mode: "random", name: "batman", roster: [] },
	comments: { enabled: true },
	helpful: { enabled: true, min_severity: "low" },
	line: { currency: defaultCurrency(), widgets: DEFAULT_WIDGETS },
	theme: { name: "houston", banding: "solid", mood_shift: false, icons: {} },
	network: { fx_refresh: true, usage_fetch: true, balance_path: "" },
};

const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const numv = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
	typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;

function stringArray(v: unknown, d: readonly string[]): readonly string[] {
	if (!Array.isArray(v)) return d;
	return v.filter((x): x is string => typeof x === "string");
}

function safeParse(s: string): Record<string, unknown> {
	try {
		return s ? parse(s) : {};
	} catch {
		return {};
	}
}

/** Spread global then project so project wins; wrong-typed keys still coerce to default. */
const section = (
	g: Record<string, unknown>,
	p: Record<string, unknown>,
	key: string,
): Record<string, unknown> => ({
	...obj(g[key]),
	...obj(p[key]),
});

function mergeWidgets(merged: Record<string, unknown>): Readonly<Record<WidgetId, boolean>> {
	const out = {} as Record<WidgetId, boolean>;
	for (const id of Object.keys(DEFAULT_WIDGETS) as WidgetId[]) {
		out[id] = bool(merged[id], DEFAULT_WIDGETS[id]);
	}
	return out;
}

function mergeIcons(merged: Record<string, unknown>): Readonly<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(merged)) {
		// A nested sub-table like [theme.icons.git_operation] parses to an object — drop non-strings.
		if (typeof v === "string") out[k] = v;
	}
	return out;
}

/** Parse and merge the global and project TOML into a fully defaulted `Config` (project overrides global). */
export function loadConfig(globalToml = "", projectToml = ""): Config {
	const g = safeParse(globalToml);
	const p = safeParse(projectToml);

	const character = section(g, p, "character");
	const comments = section(g, p, "comments");
	const helpful = section(g, p, "helpful");
	const line = section(g, p, "line");
	const theme = section(g, p, "theme");
	const network = section(g, p, "network");

	const d = DEFAULT_CONFIG;

	return {
		schema_version: numv(p["schema_version"] ?? g["schema_version"], d.schema_version),
		character: {
			enabled: bool(character["enabled"], d.character.enabled),
			mode: oneOf(character["mode"], ["fixed", "random"] as const, d.character.mode),
			name: str(character["name"], d.character.name),
			roster: stringArray(character["roster"], d.character.roster),
		},
		comments: {
			enabled: bool(comments["enabled"], d.comments.enabled),
		},
		helpful: {
			enabled: bool(helpful["enabled"], d.helpful.enabled),
			min_severity: oneOf(
				helpful["min_severity"],
				["low", "medium", "high", "critical"] as const,
				d.helpful.min_severity,
			),
		},
		line: {
			currency: str(line["currency"], d.line.currency),
			...(typeof line["budget"] === "number" ? { budget: line["budget"] } : {}),
			widgets: mergeWidgets({
				...obj(obj(g["line"])["widgets"]),
				...obj(obj(p["line"])["widgets"]),
			}),
		},
		theme: {
			name: str(theme["name"], d.theme.name),
			...(typeof theme["statusline"] === "string" ? { statusline: theme["statusline"] } : {}),
			...(typeof theme["logo"] === "string" ? { logo: theme["logo"] } : {}),
			...(typeof theme["comment"] === "string" ? { comment: theme["comment"] } : {}),
			banding: oneOf(theme["banding"], ["solid", "cycle"] as const, d.theme.banding),
			mood_shift: bool(theme["mood_shift"], d.theme.mood_shift),
			icons: mergeIcons({
				...obj(obj(g["theme"])["icons"]),
				...obj(obj(p["theme"])["icons"]),
			}),
		},
		network: {
			fx_refresh: bool(network["fx_refresh"], d.network.fx_refresh),
			usage_fetch: bool(network["usage_fetch"], d.network.usage_fetch),
			balance_path: str(network["balance_path"], d.network.balance_path),
		},
	};
}
