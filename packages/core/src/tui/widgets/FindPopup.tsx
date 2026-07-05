// The global fuzzy Find popup: a query line over a fuzzy-ranked list spanning sections, fields, and actions.
// Replaces the inline SearchBar and the retired command palette. Presentational; the Dashboard owns the query
// state and the fuzzy ranking (rankFind) and passes the windowed rows in.

import { Text } from "ink";
import type { ReactElement } from "react";

import { scrollWindow } from "..";
import type { GlyphSet, Tokens } from "../theme"; // GlyphSet lives in tui/theme

import { Popup } from "./Popup";

interface FindRow {
	readonly id: string;
	readonly label: string;
}

export interface FindPopupProps {
	readonly query: string;
	readonly rows: readonly FindRow[];
	readonly cursor: number;
	readonly columns: number;
	readonly termRows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

export function FindPopup({
	query,
	rows,
	cursor,
	columns,
	termRows,
	tokens,
	glyphs,
}: FindPopupProps): ReactElement {
	// Window the list around the cursor so it stays in view instead of scrolling off past the popup's
	// visible rows. Chrome budget: border (2) + title (1) + footer (1) + the query line (1) = 5.
	const viewport = Math.max(1, termRows - 5);
	const win = scrollWindow(rows.length, cursor, viewport);
	return (
		<Popup
			title="Find"
			footer="↵ jump · esc close"
			columns={columns}
			rows={termRows}
			tokens={tokens}>
			<Text {...tokens.accent}>{`/${query}█`}</Text>
			{rows.length === 0 ?
				<Text {...tokens.textMuted}>no matches</Text>
			:	rows.slice(win.start, win.end).map((r, i) => {
					const index = win.start + i;
					return (
						<Text key={r.id} {...(index === cursor ? tokens.accent : tokens.text)}>
							{index === cursor ? glyphs.marker : " "} {r.label}
						</Text>
					);
				})
			}
		</Popup>
	);
}
