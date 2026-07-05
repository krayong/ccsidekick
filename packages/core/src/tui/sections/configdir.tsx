// The launch-time Claude config-dir picker: the TUI's first screen. It lists the discovered `.claude*` dirs
// plus a "Custom path…" text-entry row. The cursor starts at row 0; the suggested dir starts checked.
// Space toggles a dir's checkbox; `a` toggles all; Enter confirms every checked dir. The Custom row opens
// text entry; a confirmed custom path is appended as a checked row. Only custom paths get existence checks and
// creation prompts; discovered dirs are assumed to exist. Every fs touch is guarded so a failure surfaces
// inline instead of crashing.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

import { Box, Text, useApp, useInput, type Key } from "ink";
import { type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

import { ACCENT, DANGER, FRAME, tildePath } from "..";
import type { SaveTarget } from "../shell";

import { canConfirm, checkedTargets, toggleAll, toggleOne } from "./configDirSelect";

const CUSTOM_LABEL = "Custom path…";

interface ConfigDirPickerProps {
	readonly dirs: readonly SaveTarget[];
	readonly suggested?: string;
	/** Index of the row that starts checked (the suggested dir, else `~/.claude`). */
	readonly suggestedIndex: number;
	/** Called once with the confirmed targets (created if any did not exist). */
	readonly onChosen: (targets: readonly SaveTarget[]) => void;
	/** Quits the TUI; falls back to `useApp().exit()` when not supplied. */
	readonly onQuit?: () => void;
}

type Mode = "list" | "custom" | "confirm";

/** State and setters the per-mode key handlers act on, bundled so each handler stays a pure module helper. */
interface PickerDeps {
	readonly allDirs: readonly SaveTarget[];
	readonly cursor: number;
	readonly customIndex: number;
	readonly total: number;
	readonly text: string;
	readonly pending: string | null;
	readonly checked: ReadonlySet<number>;
	readonly setCursor: Dispatch<SetStateAction<number>>;
	readonly setMode: Dispatch<SetStateAction<Mode>>;
	readonly setText: Dispatch<SetStateAction<string>>;
	readonly setPending: Dispatch<SetStateAction<string | null>>;
	readonly setError: Dispatch<SetStateAction<string | null>>;
	readonly setChecked: Dispatch<SetStateAction<Set<number>>>;
	readonly addDir: (dir: string) => void;
	readonly confirmSelection: () => void;
	readonly quit: () => void;
}

/** List mode: move the cursor, toggle a checkbox, toggle-all, open custom entry, confirm, or quit. */
function handleListKey(input: string, key: Key, d: PickerDeps): void {
	if (key.upArrow) d.setCursor((c) => Math.max(0, c - 1));
	else if (key.downArrow) d.setCursor((c) => Math.min(d.total - 1, c + 1));
	else if (input === " ") {
		if (d.cursor < d.customIndex) d.setChecked((c) => toggleOne(c, d.cursor));
	} else if (input === "a") d.setChecked((c) => toggleAll(c, d.allDirs.length));
	else if (key.return) {
		if (d.cursor === d.customIndex) d.setMode("custom");
		else if (canConfirm(d.checked)) d.confirmSelection();
	} else if (input === "q" || key.escape) d.quit();
}

/** Custom-path entry: confirm the typed path, back out, or edit the buffer. */
function handleCustomKey(input: string, key: Key, d: PickerDeps): void {
	if (key.return) {
		const path = d.text.trim();
		if (path !== "") {
			if (existsSync(path)) d.addDir(path);
			else {
				d.setPending(path);
				d.setMode("confirm");
			}
		}
	} else if (key.escape) {
		d.setMode("list");
		d.setText("");
	} else if (key.backspace || key.delete) d.setText((t) => t.slice(0, -1));
	else if (input !== "" && !key.ctrl && !key.meta) d.setText((t) => t + input);
}

/** Confirm mode: create the pending dir on Enter (surfacing failure inline), or cancel on Escape. */
function handleConfirmKey(key: Key, d: PickerDeps): void {
	if (key.return && d.pending !== null) {
		try {
			mkdirSync(d.pending, { recursive: true });
			d.addDir(d.pending);
		} catch {
			d.setError(`Could not create ${d.pending}`);
			d.setPending(null);
			d.setMode("list");
		}
	} else if (key.escape) {
		d.setPending(null);
		d.setMode("list");
	}
}

interface SingleDirConfirmProps {
	readonly target: SaveTarget;
	/** Called with the single target once the user presses Enter to continue. */
	readonly onChosen: (targets: readonly SaveTarget[]) => void;
	/** Quits the TUI; falls back to `useApp().exit()` when not supplied. */
	readonly onQuit?: () => void;
}

/** The one-discovered-target shortcut: no checklist or custom row, just an Enter-to-continue prompt. */
export function SingleDirConfirm({ target, onChosen, onQuit }: SingleDirConfirmProps): ReactNode {
	const { exit } = useApp();
	useInput((input, key) => {
		if (key.return) onChosen([target]);
		else if (input === "q" || key.escape) (onQuit ?? exit)();
	});
	return (
		<Box flexDirection="column" paddingX={1}>
			<Box
				borderStyle="round"
				borderTop={false}
				borderLeft={false}
				borderRight={false}
				borderColor={FRAME}
				paddingX={1}>
				<Text>
					<Text bold color={ACCENT}>
						ccsidekick
					</Text>
					<Text dimColor>
						{" "}
						· ccsidekick will be configured for your Claude config directory.
					</Text>
				</Text>
			</Box>
			<Box paddingX={1} marginTop={1}>
				<Text dimColor>Press ↵ to set up · esc/q quit</Text>
			</Box>
		</Box>
	);
}

export function ConfigDirPicker({
	dirs,
	suggested,
	suggestedIndex,
	onChosen,
	onQuit,
}: ConfigDirPickerProps): ReactNode {
	const { exit } = useApp();
	const home = homedir();
	const [cursor, setCursor] = useState(0);
	const [mode, setMode] = useState<Mode>("list");
	const [text, setText] = useState("");
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [extraDirs, setExtraDirs] = useState<SaveTarget[]>([]);
	const [checked, setChecked] = useState<Set<number>>(
		() => new Set(dirs.length > 0 ? [suggestedIndex] : []),
	);

	const allDirs = [...dirs, ...extraDirs];
	const customIndex = allDirs.length;
	const total = allDirs.length + 1;

	// Append a custom (global-scope) dir at the end of the list and check it, returning to list mode.
	const addDir = (dir: string): void => {
		const idx = allDirs.length;
		setExtraDirs((xs) => [...xs, { dir, scope: "global" }]);
		setChecked((c) => new Set(c).add(idx));
		setText("");
		setPending(null);
		setError(null);
		setMode("list");
	};

	const confirmSelection = (): void => {
		const selected = checkedTargets(allDirs, checked);
		if (selected.length > 0) onChosen(selected);
	};

	useInput((input, key) => {
		const deps: PickerDeps = {
			allDirs,
			cursor,
			customIndex,
			total,
			text,
			pending,
			checked,
			setCursor,
			setMode,
			setText,
			setPending,
			setError,
			setChecked,
			addDir,
			confirmSelection,
			quit: onQuit ?? exit,
		};
		if (mode === "list") handleListKey(input, key, deps);
		else if (mode === "custom") handleCustomKey(input, key, deps);
		else handleConfirmKey(key, deps);
	});

	const onList = mode === "list";
	const hint =
		mode === "custom" ? "type a path · enter add · esc back"
		: mode === "confirm" ? "enter create · esc back"
		: "space pick · a all · ↵ continue · esc/q quit";

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box
				borderStyle="round"
				borderTop={false}
				borderLeft={false}
				borderRight={false}
				borderColor={FRAME}
				paddingX={1}>
				<Text>
					<Text bold color={ACCENT}>
						ccsidekick
					</Text>
					<Text dimColor>
						{" "}
						· Choose your Claude config directory. ccsidekick will be configured for it.
					</Text>
				</Text>
			</Box>
			<Box
				flexDirection="column"
				marginTop={1}
				paddingX={1}
				borderStyle="round"
				borderColor={ACCENT}>
				<Text dimColor>CLAUDE CONFIG DIR</Text>
				{allDirs.map((t, i) => (
					<Text
						key={`${t.scope}:${t.dir}`}
						{...(onList && i === cursor ? { color: ACCENT, bold: true } : {})}>
						{onList && i === cursor ? "▸ " : "  "}
						{checked.has(i) ? "[x] " : "[ ] "}
						{t.scope === "local" ?
							"./.claude (this project · local)"
						:	tildePath(t.dir, home)}
						{t.dir === suggested ?
							<Text dimColor> · suggested</Text>
						:	null}
					</Text>
				))}
				<Text {...(onList && cursor === customIndex ? { color: ACCENT, bold: true } : {})}>
					{onList && cursor === customIndex ? "▸ " : "  "}
					{CUSTOM_LABEL}
				</Text>
				{mode === "custom" ?
					<Box marginTop={1}>
						<Text>
							Path: <Text color={ACCENT}>{text}</Text>
							<Text dimColor>▏</Text>
						</Text>
					</Box>
				:	null}
				{mode === "confirm" && pending !== null ?
					<Box marginTop={1}>
						<Text color={ACCENT}>Create {pending}? </Text>
					</Box>
				:	null}
				{error !== null ?
					<Text color={DANGER}>{error}</Text>
				:	null}
			</Box>
			<Box paddingX={1}>
				<Text dimColor>{hint}</Text>
			</Box>
		</Box>
	);
}
