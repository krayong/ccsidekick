// Browser entry for the ccsidekick statusline renderer. It drives the REAL render pipeline (`runRender` →
// acquire → derive → compose → render) with a synthetic payload and an in-memory config, so a web configurator
// gets byte-identical ANSI to what `ccsidekick-render render` writes to stdout — without any disk, stdin, or
// network. Disk/subprocess reads are neutralized by build-time node shims (see ./node-shims and ./crypto-shim);
// config is injected as TOML that the real `loadConfig` parses, and packs are bundled (see ./pack-load).

import { runRender } from "../cli";
import { DEFAULT_COLUMNS, type TermContext } from "../domain";
import { DEFAULT_CONFIG, fixedClock } from "../sources";

import { demoFiles, demoOverrides, demoPayload, gitRunner } from "./demo-fixture";
import { vfs } from "./vfs";

// A browser bundle may have no `process`; a few deep paths touch `process.env`/`process.cwd` defensively.
const g = globalThis as { process?: { env: Record<string, string>; cwd(): string; pid: number } };
g.process ??= { env: {}, cwd: () => "/home/web", pid: 0 };

const ALL_WIDGET_IDS = Object.keys(DEFAULT_CONFIG.statusline.widgets);

/** A fixed instant keeps preview output deterministic (mood pulse and tip rotation are time-seeded). */
const PREVIEW_NOW_MS = Date.UTC(2026, 0, 15, 15, 0, 0);

export interface RenderOptions {
	/** Pack name, e.g. "batman", "yoda". Defaults to the engine default. In random mode this is ignored. */
	readonly character?: string;
	/** "fixed" pins one character; "random" rotates the roster (a stable pick is shown in a static preview). */
	readonly mode?: "fixed" | "random";
	/** Characters to rotate in random mode. Ignored in fixed mode. */
	readonly roster?: readonly string[];
	/** Theme name, or "character" to match the pack's own theme (the engine default). */
	readonly theme?: string;
	/** Enabled widget ids. When omitted, the engine's default widget set is used. */
	readonly widgets?: readonly string[];
	/** Terminal width in columns (figure is dropped below ~80). Defaults to 120. */
	readonly columns?: number;
	/** Character comment line on/off. Defaults to on. */
	readonly comment?: boolean;
	/** Helpful-tip line on/off. Defaults to on. */
	readonly helpful?: boolean;
	/** Strip ANSI escapes from the output (plain text). Defaults to false (colored). */
	readonly noColor?: boolean;
}

const escapeTomlString = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function widgetsToml(enabled: readonly string[] | undefined): string {
	const lines = ALL_WIDGET_IDS.map((id) => {
		const on =
			enabled !== undefined ?
				enabled.includes(id)
			:	(DEFAULT_CONFIG.statusline.widgets as Record<string, boolean>)[id] === true;
		return `${id} = ${String(on)}`;
	});
	return lines.join("\n");
}

/**
 * Compose the global config.toml the real `loadConfig` will parse. `mode = "fixed"` pins the chosen character;
 * `mode = "random"` rotates the roster (the engine makes a stable pick for the preview's fixed session).
 */
function buildConfigToml(opts: RenderOptions): string {
	const character = opts.character ?? DEFAULT_CONFIG.character.name;
	const mode = opts.mode ?? "fixed";
	const roster = opts.roster ?? [];
	const theme = opts.theme ?? DEFAULT_CONFIG.theme.name;
	const comment = opts.comment ?? true;
	const helpful = opts.helpful ?? true;
	return [
		"schema_version = 1",
		"",
		"[character]",
		"enabled = true",
		`mode = "${mode}"`,
		`name = "${escapeTomlString(character)}"`,
		`roster = [${roster.map((r) => `"${escapeTomlString(r)}"`).join(", ")}]`,
		"",
		"[theme]",
		`name = "${escapeTomlString(theme)}"`,
		'banding = "solid"',
		"mood_shift = false",
		"",
		"[comments]",
		`character = ${String(comment)}`,
		`helpful = ${String(helpful)}`,
		'min_severity = "low"',
		"",
		"[network]",
		"fx_refresh = false",
		"usage_fetch = false",
		'balance_path = ""',
		"",
		"[statusline]",
		'currency = "USD"',
		"",
		"[statusline.widgets]",
		widgetsToml(opts.widgets),
		"",
	].join("\n");
}

/**
 * Render one statusline to ANSI, exactly as the CLI would for the given character/theme/widget selection.
 * Synchronous and side-effect-free (the pipeline's `persist` tail is discarded). Never throws — a bad selection
 * degrades to a safe line, matching CLI behavior.
 */
export function renderStatusline(opts: RenderOptions = {}): string {
	vfs.configToml = buildConfigToml(opts);
	vfs.files = new Map(Object.entries(demoFiles(PREVIEW_NOW_MS)));
	// git_branch and git_hash are mutually exclusive in real git (on a branch vs. detached), so a single git
	// state can't populate both. Default to the on-a-branch scenario; switch to the detached-at-tag scenario
	// only when git_hash is toggled on without git_branch, so that toggle still surfaces a value.
	const wantHashOnly =
		opts.widgets !== undefined &&
		opts.widgets.includes("git_hash") &&
		!opts.widgets.includes("git_branch");
	vfs.gitRunner = gitRunner(wantHashOnly ? "detached" : "branch");

	const term: TermContext = {
		columns: opts.columns ?? 120,
		noColor: opts.noColor ?? false,
		isTTY: true,
	};
	const env: Record<string, string> = {
		HOME: "/home/web",
		CLAUDE_CONFIG_DIR: "/home/web/.claude",
	};
	const { line } = runRender(
		JSON.stringify(demoPayload(PREVIEW_NOW_MS)),
		env,
		term,
		fixedClock(PREVIEW_NOW_MS),
		demoOverrides(PREVIEW_NOW_MS),
	);
	return line;
}

/** The list of bundled character pack names the configurator can offer. */
export { PACKS as characters } from "../packs";

const api = { renderStatusline, columns: DEFAULT_COLUMNS };
export default api;

// Expose a browser global for a plain <script> tag: window.CCSKRender.renderStatusline(opts) -> string.
(globalThis as { CCSKRender?: typeof api }).CCSKRender = api;
