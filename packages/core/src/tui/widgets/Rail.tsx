// The presentational three-column category -> list -> detail widget. Category and list columns are windowed
// around their cursor; the focused column's active row carries the marker glyph plus accent, the other columns
// show their selection dimmed with no marker. It holds no state and does no I/O: the parent owns `RailState` and
// computes the detail.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import { scrollWindow } from "..";
import type { GlyphSet, Tokens } from "../theme";

import type { MillerItem } from "./Miller";
import type { RailState } from "./railModel";
import { VRule } from "./VRule";

interface RailProps {
	readonly categories: readonly string[];
	readonly items: readonly MillerItem[];
	readonly detail: ReactNode;
	readonly state: RailState;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

export function Rail(props: RailProps): ReactElement {
	const { categories, items, detail, state, rows, tokens, glyphs } = props;
	const { start: catStart, end: catEnd } = scrollWindow(categories.length, state.catCursor, rows);
	const catRows = categories.slice(catStart, catEnd).map((name, i) => {
		const idx = catStart + i;
		const active = idx === state.catCursor;
		const marker = active && state.focus === 0 ? glyphs.marker : glyphs.markerBlank;
		const style = active && state.focus === 0 ? tokens.accent : tokens.text;
		return (
			<Text key={name} {...style}>
				{marker} {name}
			</Text>
		);
	});

	// Reserve one row for the "▾ N more" hint whenever the list overflows, so total lines stay ≤ rows;
	// AppShell's root Box clips with overflow="hidden", so an appended rows+1 hint would be invisible.
	const itemViewport = items.length > rows ? Math.max(1, rows - 1) : rows;
	const { start: itemStart, end: itemEnd } = scrollWindow(
		items.length,
		state.itemCursor,
		itemViewport,
	);
	const itemRows = items.slice(itemStart, itemEnd).map((item, i) => {
		const idx = itemStart + i;
		const active = idx === state.itemCursor;
		const marker = active && state.focus === 1 ? glyphs.marker : glyphs.markerBlank;
		const style = active && state.focus === 1 ? tokens.accent : tokens.text;
		return (
			<Text key={item.id} {...style}>
				{marker} {item.label}
			</Text>
		);
	});
	const hiddenBelow = items.length - itemEnd;
	const moreRow =
		hiddenBelow > 0 ?
			<Text key="__more__" {...tokens.textMuted}>
				{"  "}▾ {hiddenBelow} more
			</Text>
		:	null;

	return (
		<Box flexDirection="row">
			<Box flexDirection="column" width={14}>
				{catRows}
			</Box>
			<VRule tokens={tokens} />
			<Box flexDirection="column" width={24}>
				{itemRows}
				{moreRow}
			</Box>
			<VRule tokens={tokens} />
			<Box flexDirection="column" flexGrow={1} paddingLeft={2}>
				{detail}
			</Box>
		</Box>
	);
}
