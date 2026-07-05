// The Currency picker popup: a query line over the fx-code list (common codes first, then the rest
// alphabetically), filtered as the user types. Presentational; the Dashboard owns the query state, the
// filtered `codes`, and the cursor, and gates the `readFxCached` disk read to only when this overlay is open.

import { Text } from "ink";
import type { ReactElement } from "react";

import { scrollWindow } from "..";
import type { GlyphSet, Tokens } from "../theme"; // GlyphSet lives in tui/theme

import { Popup } from "./Popup";

export interface CurrencyPickerProps {
	readonly query: string;
	readonly codes: readonly string[];
	readonly cursor: number;
	readonly columns: number;
	readonly termRows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

export function CurrencyPicker({
	query,
	codes,
	cursor,
	columns,
	termRows,
	tokens,
	glyphs,
}: CurrencyPickerProps): ReactElement {
	// Window the list around the cursor so it stays in view instead of scrolling off past the popup's
	// visible rows. `Popup` itself spends 6 rows on its own chrome (2 borders, the title row, the divider
	// under it, the divider above the footer, and the footer row), leaving `termRows - 6` for our content;
	// the query line always claims one of those, so `bodyBudget` is what's left for items (plus the hint).
	const bodyBudget = Math.max(1, termRows - 7);
	// Reserve one more row for the "▾ N more" hint whenever the list overflows that budget, so the popup's
	// own overflow:hidden body never silently truncates the hint along with the last item it can't fit.
	const itemViewport = codes.length > bodyBudget ? Math.max(1, bodyBudget - 1) : bodyBudget;
	const win = scrollWindow(codes.length, cursor, itemViewport);
	const hiddenBelow = codes.length - win.end;
	return (
		<Popup
			title="Currency"
			footer="esc close · ↵ select"
			columns={columns}
			rows={termRows}
			tokens={tokens}>
			<Text {...tokens.accent}>{`${query}█`}</Text>
			{codes.length === 0 ?
				<Text {...tokens.textMuted}>no matches</Text>
			:	codes.slice(win.start, win.end).map((code, i) => {
					const index = win.start + i;
					return (
						<Text key={code} {...(index === cursor ? tokens.accent : tokens.text)}>
							{index === cursor ? glyphs.marker : " "} {code}
						</Text>
					);
				})
			}
			{hiddenBelow > 0 ?
				<Text {...tokens.textMuted}>
					{"  "}▾ {hiddenBelow} more
				</Text>
			:	null}
		</Popup>
	);
}
