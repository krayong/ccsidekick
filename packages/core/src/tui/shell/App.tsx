// The shell entry. When no configDir is supplied it shows the Welcome (logo + description + the reused dir
// picker) and advances to the Dashboard on selection; when one is supplied it opens the Dashboard directly. It
// owns the capability read. The wordmark is a static gradient, so there is no animation clock.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { useInput } from "ink";
import { type ReactElement, useMemo, useState } from "react";

import { discoverConfigDirs } from "..";
import { THEMES, type ThemeData } from "../../data";
import { loadConfig, type Config } from "../../sources";
import { breakpointFor, useTermSize } from "../nav";
import { detectCapability, resolveTokens } from "../theme";

import { Dashboard, type DashboardProps } from "./Dashboard";
import { projectTarget, type SaveTarget } from "./saveTarget";
import { Welcome } from "./Welcome";
import { Wizard } from "./Wizard";

export interface AppProps {
	readonly configDir?: string;
	readonly homeDir?: string;
	readonly cwd?: string;
	readonly suggestedDir?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly renderBin?: string;
	readonly initialConfig?: Config;
	readonly onQuit?: () => void;
	readonly onSave?: (config: Config, target: SaveTarget) => void;
	readonly cols?: number;
	readonly rows?: number;
	readonly packs?: readonly string[];
	readonly themeName?: string;
}

/** Map a theme name to its ThemeData, defaulting to houston for undefined or unknown names. */
export function pickTheme(name: string | undefined): ThemeData {
	if (name === undefined) return THEMES.houston;
	return (THEMES as Record<string, ThemeData>)[name] ?? THEMES.houston;
}

// The welcome screen precedes theme selection, so paint the wordmark with whatever theme the suggested/existing
// config dir already uses (falling back to houston). Never throws: a missing/unreadable config is just houston.
function welcomeTheme(suggestedDir: string | undefined): ThemeData {
	if (suggestedDir === undefined || suggestedDir === "") return THEMES.houston;
	try {
		const text = readFileSync(join(suggestedDir, "ccsidekick", "config.toml"), "utf8");
		return pickTheme(loadConfig(text).theme.name);
	} catch {
		return THEMES.houston;
	}
}

// The initial `chosen` state: a pre-supplied configDir seeds a single global target, else null (Welcome shows).
function initialChosenDirs(configDir: string | undefined): readonly SaveTarget[] | null {
	return configDir === undefined ? null : [{ dir: configDir, scope: "global" }];
}

// The config.toml a save at this target reads back from (global under the config dir, local under the project).
function configPathFor(t: SaveTarget): string {
	return t.scope === "global" ?
			join(t.dir, "ccsidekick", "config.toml")
		:	join(t.cwd ?? "", ".ccsidekick", "config.toml");
}

// A first run: none of the chosen targets already carry a config.toml. Such a launch gets the guided wizard; an
// existing config opens the dashboard straight away.
function isFirstRun(targets: readonly SaveTarget[]): boolean {
	return !targets.some((t) => existsSync(configPathFor(t)));
}

// `{ onQuit }` when supplied, else `{}` — a conditional-spread shared by the Dashboard and Welcome props, so
// exactOptionalPropertyTypes is satisfied at both without doubling this ternary in App's own body.
function onQuitProp(onQuit: (() => void) | undefined): { onQuit?: () => void } {
	return onQuit !== undefined ? { onQuit } : {};
}

// The optional entry props both the Wizard and the Dashboard accept, spread only when present so
// exactOptionalPropertyTypes holds. `initialConfig` is passed per-site (it carries the draft across a
// wizard⇄dashboard switch), so it is not folded in here.
function entryExtras(props: AppProps): {
	renderBin?: string;
	onSave?: (config: Config, target: SaveTarget) => void;
} {
	return {
		...(props.renderBin !== undefined ? { renderBin: props.renderBin } : {}),
		...(props.onSave !== undefined ? { onSave: props.onSave } : {}),
	};
}

// The initialConfig prop when a seed is present, else `{}` — the shared conditional spread for the carried draft.
function seedProp(seed: Config | undefined): { initialConfig?: Config } {
	return seed !== undefined ? { initialConfig: seed } : {};
}

// The Dashboard's non-routing props. App owns terminal size (its single useTermSize tracks resize) and threads
// the resolved columns/rows down, so the Dashboard registers no second resize listener of its own.
function dashboardBaseProps(
	props: AppProps,
	env: NodeJS.ProcessEnv,
	columns: number,
	rows: number,
): Partial<DashboardProps> {
	return {
		env,
		cols: columns,
		rows,
		...(props.themeName !== undefined ? { themeName: props.themeName } : {}),
		...(props.packs !== undefined ? { packs: props.packs } : {}),
		...onQuitProp(props.onQuit),
		...entryExtras(props),
	};
}

export function App(props: AppProps): ReactElement {
	const env = props.env ?? process.env;
	const capability = detectCapability(env);
	const tokens = resolveTokens(THEMES.houston, capability);
	const [chosen, setChosen] = useState<readonly SaveTarget[] | null>(() =>
		initialChosenDirs(props.configDir),
	);
	// The wizard is the first-run journey; a returning user (a target already carrying a config.toml) opens the
	// dashboard. Either view can switch to the other (the wizard's Ctrl+D → dashboard, the dashboard's Ctrl+W →
	// wizard); `override` pins the chosen view and carries the current draft across so no setting is lost.
	// `dirty` rides along so the target view knows the carried draft has unsaved edits: the dashboard's
	// quit guard and the wizard's Esc both key off it, so a switch never silently drops edits on quit.
	const [override, setOverride] = useState<{
		readonly view: "wizard" | "dashboard";
		readonly draft: Config;
		readonly dirty: boolean;
	} | null>(null);
	const live = useTermSize();
	const columns = props.cols ?? live.columns;
	const rows = props.rows ?? live.rows;
	const atFloor = breakpointFor(columns, rows) === "floor";
	// Keep-alive: Ink holds the process open only while an input hook is active. The floor notice mounts no
	// other input (the ConfigDirPicker is hidden below the floor), so without this the event loop would drain
	// and the program would exit on its own the moment the terminal shrinks. This always-on no-op keeps the
	// error box up until the user resizes back to a usable size.
	useInput(() => {});
	// Enumerate config dirs once (a readdir + per-candidate existsSync).
	const home = props.homeDir ?? homedir();
	const cwd = props.cwd ?? process.cwd();
	const suggested = props.suggestedDir ?? env["CLAUDE_CONFIG_DIR"];
	const wordmarkHues = useMemo(() => welcomeTheme(suggested).hues, [suggested]);
	const { dirs, suggestedIndex } = useMemo(
		() => discoverConfigDirs(home, suggested),
		[home, suggested],
	);
	// The picker always offers the current project as a local target, appended after the home dirs so
	// `suggestedIndex` (computed over `dirs` alone) still indexes correctly into the combined list. Launching from
	// $HOME makes the project's `.claude` the same dir as a listed home target (e.g. `~/.claude`), so the project
	// row is suppressed rather than offering the identical dir twice under two scopes.
	const options = useMemo((): readonly SaveTarget[] => {
		const homeTargets = dirs.map((dir): SaveTarget => ({ dir, scope: "global" }));
		const project = projectTarget(cwd, home);
		const isDuplicate = homeTargets.some((t) => t.dir === project.dir);
		return isDuplicate ? homeTargets : [...homeTargets, project];
	}, [dirs, cwd, home]);

	const dashboardProps = dashboardBaseProps(props, env, columns, rows);

	if (chosen === null) {
		return (
			<Welcome
				dirs={options}
				suggestedIndex={suggestedIndex}
				onChosen={setChosen}
				columns={columns}
				rows={rows}
				atFloor={atFloor}
				hues={wordmarkHues}
				capability={capability}
				tokens={tokens}
				{...(suggested !== undefined ? { suggested } : {})}
				{...onQuitProp(props.onQuit)}
			/>
		);
	}

	// A pinned override wins; otherwise a first run (no config.toml yet) opens the wizard and everyone else the
	// dashboard. The carried draft seeds whichever view shows, so a Ctrl+D / Ctrl+W switch preserves edits.
	const view = override?.view ?? (isFirstRun(chosen) ? "wizard" : "dashboard");
	const seed = override?.draft ?? props.initialConfig;

	if (view === "wizard") {
		return (
			<Wizard
				targets={chosen}
				cols={columns}
				rows={rows}
				env={env}
				initialDirty={override?.dirty ?? false}
				onAdvanced={(draft) => {
					// Leaving the wizard always carries an unsaved draft into the dashboard.
					setOverride({ view: "dashboard", draft, dirty: true });
				}}
				{...onQuitProp(props.onQuit)}
				{...entryExtras(props)}
				{...seedProp(seed)}
			/>
		);
	}

	return (
		<Dashboard
			{...dashboardProps}
			targets={chosen}
			initialDirty={override?.dirty ?? false}
			onWizard={(draft, dirty) => {
				setOverride({ view: "wizard", draft, dirty });
			}}
			{...seedProp(seed)}
		/>
	);
}
