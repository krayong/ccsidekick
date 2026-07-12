// The non-interactive setup command: `ccsidekick setup [flags]`. Parses config-field flags, patches them onto the
// existing config (or the defaults on a fresh install), and writes `config.toml` plus the `settings.json` wiring
// through the injected `save`. Only the flags actually passed are applied, so the command is an idempotent partial
// patch. Every enum value is validated against the live registry/theme catalog; an unknown value fails loudly
// rather than silently falling back. No Ink/React: this is plain command logic, dispatched before the bin's lazy
// UI import.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { THEMES } from "../data";
import type { WidgetId } from "../domain";
import { PACKS } from "../packs";
import { CHARACTER_THEME } from "../render";
import { type Config, DEFAULT_CONFIG, loadConfig } from "../sources";
import type { SaveScope } from "../tui";

const WIDGET_IDS = Object.keys(DEFAULT_CONFIG.statusline.widgets) as readonly WidgetId[];
const MODES = ["fixed", "random"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

/** The valid `--theme` values: the character sentinel, the built-in theme catalog, and every pack's own theme. */
export function themeNames(): readonly string[] {
	return [CHARACTER_THEME, ...Object.keys(THEMES), ...PACKS];
}

/** The valid values for a `list` subcommand target. */
export function listValues(kind: string): readonly string[] | null {
	if (kind === "characters") return PACKS;
	if (kind === "themes") return themeNames();
	if (kind === "widgets") return WIDGET_IDS;
	return null;
}

interface ParsedFlags {
	character?: string;
	mode?: "fixed" | "random";
	roster?: readonly string[];
	theme?: string;
	currency?: string;
	budget?: number;
	comments?: boolean;
	helpful?: boolean;
	minSeverity?: (typeof SEVERITIES)[number];
	widgets?: readonly WidgetId[];
	usageFetch?: boolean;
}

interface Target {
	readonly scope: SaveScope;
	readonly dir: string;
}

export interface Parsed {
	readonly flags: ParsedFlags;
	readonly target: Target;
	readonly errors: readonly string[];
}

const VALUE_FLAGS = new Set([
	"character",
	"mode",
	"roster",
	"theme",
	"currency",
	"budget",
	"comments",
	"helpful",
	"min-severity",
	"widgets",
	"usage-fetch",
	"config-dir",
]);
const BOOL_FLAGS = new Set(["global", "local"]);

const splitList = (raw: string): readonly string[] =>
	raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");

const invalid = (flag: string, value: string, valid: readonly string[]): string =>
	`ccsidekick: invalid --${flag} "${value}". Valid: ${valid.join(", ")}`;

const parseOnOff = (flag: string, value: string, errors: string[]): boolean | undefined => {
	if (value === "on") return true;
	if (value === "off") return false;
	errors.push(invalid(flag, value, ["on", "off"]));
	return undefined;
};

/** Split the raw argv (after `setup`) into `--flag value` / `--flag=value` pairs and standalone booleans. */
function tokenize(argv: readonly string[]): {
	pairs: Map<string, string>;
	bools: Set<string>;
	errors: string[];
} {
	const pairs = new Map<string, string>();
	const bools = new Set<string>();
	const errors: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i] ?? "";
		if (!tok.startsWith("--")) {
			errors.push(`ccsidekick: unexpected argument "${tok}"`);
			continue;
		}
		const body = tok.slice(2);
		const eq = body.indexOf("=");
		const key = eq >= 0 ? body.slice(0, eq) : body;
		if (BOOL_FLAGS.has(key)) {
			bools.add(key);
			continue;
		}
		if (!VALUE_FLAGS.has(key)) {
			errors.push(`ccsidekick: unknown flag "--${key}"`);
			continue;
		}
		if (eq >= 0) {
			pairs.set(key, body.slice(eq + 1));
			continue;
		}
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) {
			errors.push(`ccsidekick: --${key} needs a value`);
			continue;
		}
		pairs.set(key, next);
		i++;
	}
	return { pairs, bools, errors };
}

const memberOf = <T extends string>(value: string, valid: readonly T[]): value is T =>
	(valid as readonly string[]).includes(value);

/** Set a single enum-valued flag, or record an error listing the valid set. */
function enumInto<T extends string>(
	value: string,
	valid: readonly T[],
	flag: string,
	errors: string[],
	set: (v: T) => void,
): void {
	if (memberOf(value, valid)) set(value);
	else errors.push(invalid(flag, value, valid));
}

/** Set a comma-list flag whose every entry must be valid, or record an error naming the offenders. */
function listInto<T extends string>(
	value: string,
	valid: readonly T[],
	flag: string,
	errors: string[],
	set: (v: readonly T[]) => void,
): void {
	const list = splitList(value);
	const bad = list.filter((x) => !memberOf(x, valid));
	if (bad.length > 0) errors.push(invalid(flag, bad.join(","), valid));
	else set(list as readonly T[]);
}

// One validator per value flag: read the raw string, validate, and either set the typed field or push an error.
// Table-driven so parseSetup stays a simple loop rather than a long branch chain.
const VALIDATORS: Readonly<
	Record<string, (value: string, flags: ParsedFlags, errors: string[]) => void>
> = {
	character: (v, f, e) => {
		enumInto(v, PACKS, "character", e, (x) => (f.character = x));
	},
	mode: (v, f, e) => {
		enumInto(v, MODES, "mode", e, (x) => (f.mode = x));
	},
	roster: (v, f, e) => {
		listInto(v, PACKS, "roster", e, (x) => (f.roster = x));
	},
	theme: (v, f, e) => {
		enumInto(v, themeNames(), "theme", e, (x) => (f.theme = x));
	},
	currency: (v, f, e) => {
		const u = v.trim().toUpperCase();
		if (u === "") e.push("ccsidekick: --currency needs a code");
		else f.currency = u;
	},
	budget: (v, f, e) => {
		const n = Number(v);
		if (Number.isFinite(n) && n >= 0) f.budget = n;
		else e.push(`ccsidekick: invalid --budget "${v}" (want a number >= 0)`);
	},
	comments: (v, f, e) => {
		const b = parseOnOff("comments", v, e);
		if (b !== undefined) f.comments = b;
	},
	helpful: (v, f, e) => {
		const b = parseOnOff("helpful", v, e);
		if (b !== undefined) f.helpful = b;
	},
	"min-severity": (v, f, e) => {
		enumInto(v, SEVERITIES, "min-severity", e, (x) => (f.minSeverity = x));
	},
	widgets: (v, f, e) => {
		listInto(v, WIDGET_IDS, "widgets", e, (x) => (f.widgets = x));
	},
	"usage-fetch": (v, f, e) => {
		const b = parseOnOff("usage-fetch", v, e);
		if (b !== undefined) f.usageFetch = b;
	},
};

/** Parse and validate the setup argv into typed flags plus a save target. Collects every error rather than throwing. */
export function parseSetup(
	argv: readonly string[],
	homeDir: string,
	env: NodeJS.ProcessEnv,
): Parsed {
	const { pairs, bools, errors } = tokenize(argv);
	const flags: ParsedFlags = {};
	for (const [key, value] of pairs) VALIDATORS[key]?.(value, flags, errors);

	if (bools.has("global") && bools.has("local"))
		errors.push("ccsidekick: pass only one of --global / --local");
	const scope: SaveScope = bools.has("local") ? "local" : "global";
	const dir = pairs.get("config-dir") ?? env["CLAUDE_CONFIG_DIR"] ?? join(homeDir, ".claude");

	return { flags, target: { scope, dir }, errors };
}

/** Patch the parsed flags onto a base config. Only provided flags change; everything else is preserved. */
export function applySetup(base: Config, flags: ParsedFlags): Config {
	// `--character` alone implies fixed mode: random mode ignores the named character, so a bare
	// `--character X` would otherwise be a silent no-op. An explicit `--mode` always wins.
	const mode =
		flags.mode ?? (flags.character !== undefined ? ("fixed" as const) : base.character.mode);
	const character = {
		...base.character,
		mode,
		...(flags.character !== undefined ? { name: flags.character } : {}),
		...(flags.roster !== undefined ? { roster: flags.roster } : {}),
	};
	const statusline = {
		...base.statusline,
		...(flags.currency !== undefined ? { currency: flags.currency } : {}),
		...(flags.budget !== undefined ? { budget: flags.budget } : {}),
		...(flags.widgets !== undefined ?
			{
				widgets: Object.fromEntries(
					WIDGET_IDS.map((id) => [id, flags.widgets?.includes(id) ?? false]),
				) as Readonly<Record<WidgetId, boolean>>,
			}
		:	{}),
	};
	return {
		...base,
		character,
		statusline,
		comments: {
			...base.comments,
			...(flags.comments !== undefined ? { character: flags.comments } : {}),
			...(flags.helpful !== undefined ? { helpful: flags.helpful } : {}),
			...(flags.minSeverity !== undefined ? { min_severity: flags.minSeverity } : {}),
		},
		theme: flags.theme !== undefined ? { ...base.theme, name: flags.theme } : base.theme,
		network:
			flags.usageFetch !== undefined ?
				{ ...base.network, usage_fetch: flags.usageFetch }
			:	base.network,
	};
}

export interface SetupDeps {
	readonly save: (
		config: Config,
		scope: SaveScope,
		dir: string,
		renderBin: string,
		opts: { readonly cwd?: string; readonly wireLocalSettings?: boolean },
	) => void;
	readonly renderBin: string;
	/** Reads a config file's text, or returns null when it does not exist. Injectable for tests. */
	readonly readConfig: (path: string) => string | null;
	readonly cwd: string;
	readonly homeDir: string;
	readonly env: NodeJS.ProcessEnv;
	readonly out: (s: string) => void;
	readonly err: (s: string) => void;
}

/** The config path a save at this target reads back from (global under the config dir, local under the cwd). */
function existingConfigPath(target: Target, cwd: string): string {
	return target.scope === "global" ?
			join(target.dir, "ccsidekick", "config.toml")
		:	join(cwd, ".ccsidekick", "config.toml");
}

/** Run `ccsidekick setup`. Returns the process exit code (0 success, 1 on any validation or IO error). */
export function runSetup(argv: readonly string[], deps: SetupDeps): number {
	const parsed = parseSetup(argv, deps.homeDir, deps.env);
	if (parsed.errors.length > 0) {
		for (const e of parsed.errors) deps.err(`${e}\n`);
		return 1;
	}
	const existingText = deps.readConfig(existingConfigPath(parsed.target, deps.cwd));
	const base = existingText !== null ? loadConfig(existingText) : DEFAULT_CONFIG;
	const config = applySetup(base, parsed.flags);
	try {
		deps.save(config, parsed.target.scope, parsed.target.dir, deps.renderBin, {
			cwd: deps.cwd,
			wireLocalSettings: parsed.target.scope === "local",
		});
	} catch (e) {
		deps.err(`ccsidekick: ${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
	deps.out(
		`ccsidekick: configured ${config.character.name} (${config.character.mode}), theme ${config.theme.name}. ` +
			`Wired ${parsed.target.scope} at ${parsed.target.dir}.\n`,
	);
	return 0;
}

/** Run `ccsidekick list <characters|themes|widgets>`, printing one value per line. Returns the exit code. */
export function runList(
	kind: string | undefined,
	out: (s: string) => void,
	err: (s: string) => void,
): number {
	const values = kind === undefined ? null : listValues(kind);
	if (values === null) {
		err("ccsidekick: list expects one of: characters, themes, widgets\n");
		return 1;
	}
	out(`${values.join("\n")}\n`);
	return 0;
}

/** The `ccsidekick setup --help` text, enumerating every flag and its valid values from the live registry. */
export function setupHelp(): string {
	return [
		"ccsidekick setup — configure and wire ccsidekick without the TUI",
		"",
		"Usage: ccsidekick setup [flags]",
		"",
		"Flags (only the ones you pass are applied):",
		`  --character <name>      ${PACKS.join(", ")}`,
		`  --mode <mode>           ${MODES.join(", ")}`,
		"  --roster <a,b,c>        characters for random mode (from --character's list)",
		`  --theme <name>          ${themeNames().join(", ")}`,
		"  --currency <code>       e.g. USD, EUR, INR",
		"  --budget <usd>          monthly budget, a number >= 0",
		"  --comments <on|off>     the character's own comment line",
		"  --helpful <on|off>      the helpful-tip line",
		`  --min-severity <sev>    ${SEVERITIES.join(", ")}`,
		"  --widgets <a,b,c>       statusline widgets to enable (others are turned off)",
		"  --usage-fetch <on|off>  account-usage lookup to Anthropic (needed by the pay_as_you_go widget; no tokens)",
		"  --global | --local      save target (default: global)",
		"  --config-dir <path>     Claude config dir (default: $CLAUDE_CONFIG_DIR or ~/.claude)",
		"",
		"List valid values for scripting: ccsidekick list characters|themes|widgets",
		"",
	].join("\n");
}

/** Default config reader used by the bin: returns the file text, or null when it is absent/unreadable. */
export function defaultReadConfig(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** The default homedir, exported so the bin need not import node:os just for this. */
export const defaultHomeDir = homedir;
