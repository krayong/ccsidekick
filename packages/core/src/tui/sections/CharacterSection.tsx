// The Character section on the three-column Rail: two categories, Mode and Roster. Mode lists fixed/random with
// the active one marked; Roster lists the bundled packs, each marked when active (in random mode an empty roster
// means "all", so every pack shows selected). The detail shows the highlighted character's figure. Every pack
// ships with the engine, so there is no install path. Presentational only: every value is passed in; the
// Dashboard (or Wizard) owns the RailState.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { figureColor } from "../../render";
import { hexForXterm, type GlyphSet, type Tokens } from "../theme";
import { Rail, type MillerItem, type RailState } from "../widgets";

export interface CharacterDetail {
	readonly ok: boolean;
	readonly displayName: string;
	readonly figure: readonly string[];
	readonly moods: readonly string[];
	readonly artist: string;
	readonly source: string;
	readonly tone: string;
	readonly emblem: string;
}

const isBlank = (ch: string): boolean => ch === " " || ch === "⠀";

export interface CharacterSectionProps {
	readonly state: RailState;
	readonly packs: readonly string[];
	readonly activeIds: readonly string[];
	readonly mode: "fixed" | "random";
	readonly detail: CharacterDetail;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
	readonly hues: readonly number[];
	readonly nowMs: number;
	readonly moodShift: boolean;
}

export function CharacterSection(props: CharacterSectionProps): ReactElement {
	const { state, packs, activeIds, mode, detail, rows, tokens, glyphs, hues, nowMs, moodShift } =
		props;

	const modeItems: MillerItem[] = (["fixed", "random"] as const).map((m) => ({
		id: m,
		label: `${mode === m ? glyphs.tabActive : glyphs.tabInactive} ${m}`,
	}));
	const rosterItems: MillerItem[] = packs.map((id) => ({
		id,
		label: `${activeIds.includes(id) ? glyphs.tabActive : glyphs.tabInactive} ${id}`,
	}));

	const figW = Math.max(1, ...detail.figure.map((r) => Array.from(r).length));
	const figH = Math.max(1, detail.figure.length);
	const figureRows = detail.figure.map((row, y) => (
		<Text key={`fig-${String(y)}`} {...tokens.text}>
			{tokens.capability === "full" ?
				Array.from(row).map((ch, x) =>
					isBlank(ch) ? ch : (
						<Text
							key={`c-${String(x)}`}
							color={hexForXterm(
								figureColor(hues, x, y, figW, figH, "idle", nowMs, moodShift),
							)}>
							{ch}
						</Text>
					),
				)
			:	row}
		</Text>
	));

	const figure =
		detail.ok ?
			<Box flexDirection="column">
				<Text {...tokens.accent}>{`${detail.emblem}  ${detail.displayName}`}</Text>
				<Text> </Text>
				{figureRows}
			</Box>
		:	<Box flexDirection="column">
				<Text {...tokens.accent}>{detail.displayName}</Text>
				<Text {...tokens.textMuted}>metadata unavailable</Text>
			</Box>;

	// Mode category leads its detail with a one-line explanation of the highlighted mode, then the figure.
	const detailNode =
		state.catCursor === 0 ?
			<Box flexDirection="column">
				<Text {...tokens.textMuted}>
					{mode === "fixed" ?
						"Shows one fixed character."
					:	"Rotates through the roster each session."}
				</Text>
				<Text> </Text>
				{figure}
			</Box>
		:	figure;

	const items: readonly MillerItem[] = state.catCursor === 0 ? modeItems : rosterItems;

	return (
		<Rail
			categories={["Mode", "Roster"]}
			items={items}
			detail={detailNode}
			state={state}
			rows={rows}
			tokens={tokens}
			glyphs={glyphs}
		/>
	);
}
