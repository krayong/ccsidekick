// The presentational miller-column widget: a windowed list on the left, a live detail node on the right, split by
// one vertical rule. The active row carries the marker glyph plus accent so selection survives NO_COLOR. It holds
// no state and does no I/O: the parent owns the cursor and computes the detail.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import { scrollWindow } from "..";
import type { GlyphSet, Tokens } from "../theme";

export interface MillerItem {
	readonly id: string;
	readonly label: string;
}

interface MillerProps {
	readonly items: readonly MillerItem[];
	readonly cursor: number;
	readonly detail: ReactNode;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

export function Miller(props: MillerProps): ReactElement {
	const { items, cursor, detail, rows, tokens, glyphs } = props;
	const { start, end } = scrollWindow(items.length, cursor, rows);
	const shown = items.slice(start, end);
	const list = shown.map((item, i) => {
		const idx = start + i;
		const active = idx === cursor;
		const marker = active ? glyphs.marker : glyphs.markerBlank;
		return (
			<Text key={item.id} {...(active ? tokens.accent : tokens.text)}>
				{marker} {item.label}
			</Text>
		);
	});

	return (
		<Box flexDirection="row">
			<Box flexDirection="column" width={24}>
				{list}
			</Box>
			<Text {...tokens.frame}>{glyphs.vRule}</Text>
			<Box flexDirection="column" flexGrow={1} paddingLeft={2}>
				{detail}
			</Box>
		</Box>
	);
}
