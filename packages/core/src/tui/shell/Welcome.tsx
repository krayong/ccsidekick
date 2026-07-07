// The TUI's first screen: the shimmer wordmark (or a plain brand line when the terminal is narrower than the
// wordmark), a one-line description, and either the ConfigDirPicker or, when exactly one target is on offer, the
// SingleDirConfirm (press-enter, no path shown). Presentational plus that child's own input; App supplies the
// candidate targets and the onChosen callback, so no target enumeration lives here.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { ConfigDirPicker, SingleDirConfirm } from "../sections";
import type { Capability, Tokens } from "../theme";

import { Logo } from "./Logo";
import type { SaveTarget } from "./saveTarget";
import { LOGO_MIN_COLUMNS } from "./wordmark";

export interface WelcomeProps {
	readonly dirs: readonly SaveTarget[];
	readonly suggestedIndex: number;
	readonly suggested?: string;
	readonly onChosen: (targets: readonly SaveTarget[]) => void;
	/** Quits the TUI; falls back to `useApp().exit()` when not supplied. */
	readonly onQuit?: () => void;
	readonly columns: number;
	readonly rows: number;
	readonly atFloor: boolean;
	readonly hues: readonly number[];
	readonly capability: Capability;
	readonly tokens: Tokens;
}

const DESCRIPTION = "Your Claude Code sidekick with the whole session at a glance.";

export function Welcome({
	dirs,
	suggestedIndex,
	suggested,
	onChosen,
	onQuit,
	columns,
	rows,
	atFloor,
	hues,
	capability,
	tokens,
}: WelcomeProps): ReactElement {
	const showLogo = columns >= LOGO_MIN_COLUMNS;
	// A single discovered target needs no choice: show it and let Enter continue, rather than the full picker.
	const onlyTarget = dirs.length === 1 ? dirs[0] : undefined;
	const content = (
		<Box flexDirection="column" alignItems="center">
			{showLogo ?
				<Logo hues={hues} capability={capability} tokens={tokens} />
			:	<Text {...tokens.accent}>ccsidekick</Text>}
			<Box marginTop={1}>
				<Text {...tokens.textMuted}>{DESCRIPTION}</Text>
			</Box>
			<Box marginTop={1}>
				{onlyTarget !== undefined ?
					<SingleDirConfirm
						target={onlyTarget}
						onChosen={onChosen}
						{...(onQuit !== undefined ? { onQuit } : {})}
					/>
				:	<ConfigDirPicker
						dirs={dirs}
						suggestedIndex={suggestedIndex}
						onChosen={onChosen}
						{...(suggested !== undefined ? { suggested } : {})}
						{...(onQuit !== undefined ? { onQuit } : {})}
					/>
				}
			</Box>
		</Box>
	);

	if (atFloor) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<Text {...tokens.accent}>ccsidekick</Text>
				<Box marginTop={1}>
					<Text {...tokens.critical}>Terminal too small.</Text>
				</Box>
				<Text {...tokens.textMuted}>
					Resize to at least 80x24. Current: {columns}x{rows}.
				</Text>
			</Box>
		);
	}

	return (
		<Box
			width={columns}
			height={rows}
			alignItems="center"
			justifyContent="center"
			borderStyle="round"
			borderColor={tokens.frame.color ?? "gray"}>
			{content}
		</Box>
	);
}
