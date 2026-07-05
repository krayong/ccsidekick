// The shell entry. When no configDir is supplied it shows the Welcome (logo + description + the reused dir
// picker) and advances to the Dashboard on selection; when one is supplied it opens the Dashboard directly. It
// owns the capability/reduced-motion reads and the logo shimmer clock (a light interval, off under reducedMotion).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { useInput } from "ink";
import { type ReactElement, useEffect, useMemo, useState } from "react";

import { discoverConfigDirs } from "..";
import { THEMES, type ThemeData } from "../../data";
import { loadConfig, type Config } from "../../sources";
import { breakpointFor, useTermSize } from "../nav";
import { detectCapability, detectReducedMotion, resolveTokens } from "../theme";

import { Dashboard } from "./Dashboard";
import { projectTarget, type SaveTarget } from "./saveTarget";
import { Welcome } from "./Welcome";
import { LOGO_MIN_COLUMNS } from "./wordmark";

export interface AppProps {
	readonly configDir?: string;
	readonly homeDir?: string;
	readonly cwd?: string;
	readonly suggestedDir?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly renderBin?: string;
	readonly installed?: readonly string[];
	readonly initialConfig?: Config;
	readonly onQuit?: () => void;
	readonly onSave?: (config: Config, target: SaveTarget) => void;
	readonly cols?: number;
	readonly rows?: number;
	readonly packs?: readonly string[];
	readonly install?: (name: string) => Promise<void>;
	readonly themeName?: string;
}

// The logo shimmer clock: a coarse wall-clock tick that drifts the gradient. The interval runs only while it is
// both wanted (`active`) and allowed (`!reducedMotion`); it is cleared otherwise. So once the dashboard is active
// (or under reducedMotion) no timer ticks and the frozen path renders once without re-rendering — critical because
// this interval otherwise lives for the App's lifetime and would force a full dashboard repaint every ~120ms,
// showing up as keystroke lag. Dep array [reducedMotion, active]. Exported so the stop-on-inactive path is unit-testable.
export function useShimmerNow(reducedMotion: boolean, active: boolean): number {
	const [now, setNow] = useState<number>(() => Date.now());
	useEffect(() => {
		if (reducedMotion || !active) return;
		const id = setInterval(() => {
			setNow(Date.now());
		}, 120);
		return () => {
			clearInterval(id);
		};
	}, [reducedMotion, active]);
	return now;
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

// `{ onQuit }` when supplied, else `{}` — a conditional-spread shared by the Dashboard and Welcome props, so
// exactOptionalPropertyTypes is satisfied at both without doubling this ternary in App's own body.
function onQuitProp(onQuit: (() => void) | undefined): { onQuit?: () => void } {
	return onQuit !== undefined ? { onQuit } : {};
}

export function App(props: AppProps): ReactElement {
	const env = props.env ?? process.env;
	const capability = detectCapability(env);
	const reducedMotion = detectReducedMotion(env);
	const tokens = resolveTokens(THEMES.houston, capability);
	const [chosen, setChosen] = useState<readonly SaveTarget[] | null>(() =>
		initialChosenDirs(props.configDir),
	);
	const live = useTermSize();
	const columns = props.cols ?? live.columns;
	const rows = props.rows ?? live.rows;
	const atFloor = breakpointFor(columns, rows) === "floor";
	// Keep-alive: Ink holds the process open only while an input hook is active. The floor notice mounts no
	// other input (the ConfigDirPicker is hidden below the floor), so without this the event loop would drain
	// and the program would exit on its own the moment the terminal shrinks. This always-on no-op keeps the
	// error box up until the user resizes back to a usable size.
	useInput(() => {});
	// The shimmer clock ticks only while the Welcome's wordmark is actually on screen and animated: the Welcome is
	// active (chosen === null), motion is allowed, the terminal paints the full-color shimmer, and it is wide enough
	// to show the wordmark at all. Anywhere else (Dashboard, reduced motion, 16-color, too-narrow, or floor) no timer
	// runs, so nothing re-renders ~8x/sec for an invisible animation.
	const animating =
		chosen === null && capability === "full" && columns >= LOGO_MIN_COLUMNS && !atFloor;
	const nowMs = useShimmerNow(reducedMotion, animating);
	// Enumerate config dirs once (a readdir + per-candidate existsSync), not on every shimmer frame.
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

	// Everything the Dashboard needs, minus the entry-only routing props. App owns terminal size (its single
	// useTermSize tracks resize) and threads the resolved columns/rows down, so the Dashboard registers no
	// second resize listener of its own.
	const dashboardProps = {
		env,
		reducedMotion,
		cols: columns,
		rows,
		...(props.themeName !== undefined ? { themeName: props.themeName } : {}),
		...onQuitProp(props.onQuit),
		...(props.onSave !== undefined ? { onSave: props.onSave } : {}),
		...(props.renderBin !== undefined ? { renderBin: props.renderBin } : {}),
		...(props.initialConfig !== undefined ? { initialConfig: props.initialConfig } : {}),
		...(props.packs !== undefined ? { packs: props.packs } : {}),
		...(props.installed !== undefined ? { installed: props.installed } : {}),
		...(props.install !== undefined ? { install: props.install } : {}),
	};

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
				reducedMotion={reducedMotion}
				nowMs={nowMs}
				tokens={tokens}
				{...(suggested !== undefined ? { suggested } : {})}
				{...onQuitProp(props.onQuit)}
			/>
		);
	}

	return <Dashboard {...dashboardProps} targets={chosen} />;
}
