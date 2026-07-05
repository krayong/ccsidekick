// The Character section on the three-column Rail: Roster and Browse categories over the pack union. Roster's
// list leads with a Mode row (toggles fixed/random) followed by the pack union, and its detail shows just the
// selected character's name and figure; Browse marks installed packs and drives install through a Spinner while
// pending, an inline error line on failure, and an install affordance otherwise. A Browse category holding
// nothing but the bundled default pack shows a fallback line instead of a list. Presentational only: every
// value is passed in; the Dashboard owns the RailState and the async install.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import { BUNDLED_PACK } from "../../packs";
import { figureColor } from "../../render";
import { hexForXterm, type GlyphSet, type Tokens } from "../theme";
import { Rail, Spinner, type MillerItem, type RailState } from "../widgets";

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

// The stable id of the Roster list's leading Mode row. Dashboard does not need to know this id: it routes
// Enter by itemCursor === 0, matching the row's fixed position at the top of rosterItems.
const MODE_ROW = "__mode__";

export interface CharacterSectionProps {
	readonly state: RailState;
	readonly packs: readonly string[];
	readonly installed: readonly string[];
	readonly activeIds: readonly string[];
	readonly mode: "fixed" | "random";
	readonly detail: CharacterDetail;
	readonly installStatus: "idle" | "installing" | "error";
	readonly errorMsg?: string;
	readonly reducedMotion?: boolean;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
	readonly hues: readonly number[];
	readonly nowMs: number;
	readonly moodShift: boolean;
}

export function CharacterSection(props: CharacterSectionProps): ReactElement {
	const {
		state,
		packs,
		installed,
		activeIds,
		mode,
		detail,
		installStatus,
		errorMsg,
		reducedMotion = false,
		rows,
		tokens,
		glyphs,
		hues,
		nowMs,
		moodShift,
	} = props;

	const rosterItems: MillerItem[] = [
		{ id: MODE_ROW, label: `Mode  ${glyphs.marker} ${mode}` },
		...packs.map((id) => ({
			id,
			label: `${activeIds.includes(id) ? glyphs.tabActive : glyphs.tabInactive} ${id}`,
		})),
	];
	const browseItems: MillerItem[] = packs.map((id) => ({
		id,
		label: `${installed.includes(id) ? glyphs.tabActive : glyphs.tabInactive} ${id}`,
	}));
	const otherPacks = packs.filter((id) => id !== BUNDLED_PACK);
	const browseEmpty = otherPacks.length === 0;
	const selectedId = packs[Math.min(state.itemCursor, packs.length - 1)] ?? packs[0] ?? "";

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

	const rosterDetail =
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

	const browseDetail = (
		<Box flexDirection="column">
			<Text {...tokens.accent}>{detail.displayName}</Text>
			{installStatus === "installing" ?
				reducedMotion ?
					<Text {...tokens.textMuted}>Installing{glyphs.ellipsis}</Text>
				:	<Spinner label="Installing..." />
			:	null}
			{installStatus === "error" ?
				<Text {...tokens.critical}>! {errorMsg ?? "install failed"}</Text>
			:	null}
			{installStatus === "idle" && installed.includes(selectedId) ?
				<Text {...tokens.nominal}>installed</Text>
			:	null}
			{installStatus === "idle" && !installed.includes(selectedId) ?
				<Text {...tokens.textMuted}>[enter] install</Text>
			:	null}
		</Box>
	);

	const items: readonly MillerItem[] =
		state.catCursor === 0 ? rosterItems
		: browseEmpty ? []
		: browseItems;
	const body: ReactNode =
		state.catCursor === 0 ? rosterDetail
		: browseEmpty ? <Text {...tokens.textMuted}>no other packs available</Text>
		: browseDetail;

	return (
		<Rail
			categories={["Roster", "Browse"]}
			items={items}
			detail={body}
			state={state}
			rows={rows}
			tokens={tokens}
			glyphs={glyphs}
		/>
	);
}
