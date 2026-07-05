// The Install section: confirm the target and scope, then press Enter (or Ctrl+S from anywhere) to open the
// save-confirm popup. The save-failure banner is not here: a failed y/↵ install renders its Alert inside the
// save-confirm popup body, not on this panel (which isn't rendered while the overlay is open).

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import type { SaveTarget } from "../shell";
import type { Tokens } from "../theme";

export interface InstallPanelProps {
	readonly scope: "global" | "local" | "mixed";
	readonly dirty: boolean;
	readonly targets: readonly SaveTarget[];
	readonly tokens: Tokens;
}

// The project target is the only one that ever carries a `cwd` (see saveTarget.ts); it is the sole target a
// user can flip between global and local, so it alone renders the `[global | local]` toggle. Every other
// target (a home dir) is always global and renders a plain label.
function TargetRow({
	t,
	tokens,
}: {
	readonly t: SaveTarget;
	readonly tokens: Tokens;
}): ReactElement {
	if (t.cwd === undefined) {
		return (
			<Text {...tokens.textMuted}>
				{"  "}
				{t.dir} (global)
			</Text>
		);
	}
	return (
		<Text {...tokens.textMuted}>
			{"  "}
			{t.dir} [
			<Text {...(t.scope === "global" ? tokens.accent : tokens.textMuted)}>global</Text>
			{" | "}
			<Text {...(t.scope === "local" ? tokens.accent : tokens.textMuted)}>local</Text>]
			(space: toggle scope)
		</Text>
	);
}

export function InstallPanel({ scope, dirty, targets, tokens }: InstallPanelProps): ReactElement {
	return (
		<Box flexDirection="column">
			<Text {...tokens.text}>
				Scope: <Text {...tokens.accent}>{scope}</Text>
			</Text>
			<Text {...tokens.textMuted}>
				{targets.length === 1 ?
					`Target: ${targets[0]?.dir ?? ""}`
				:	`Targets: ${String(targets.length)} directories`}
			</Text>
			{targets.map((t) => (
				<TargetRow key={`${t.scope}:${t.dir}`} t={t} tokens={tokens} />
			))}
			<Box marginTop={1}>
				<Text {...(dirty ? tokens.caution : tokens.nominal)}>
					{dirty ? "Unsaved changes." : "Everything saved."} Press ↵ to review and
					install.
				</Text>
			</Box>
		</Box>
	);
}
