// The live preview: a centered popup holding the real statusline output for the current draft under the
// selected scenario, with a header (scenario label + position + flags). Presentational only: the body ANSI
// string is computed by the dashboard.

import { Text } from "ink";
import type { ReactElement } from "react";

import { displayWidth, truncateAnsi } from "../../render";
import type { Tokens } from "../theme";
import { Popup, popupTextWidth } from "../widgets";

export interface PreviewPanelProps {
	readonly label: string;
	readonly body: string;
	readonly columns: number;
	readonly rows: number;
	readonly index: number;
	readonly count: number;
	readonly noColor: boolean;
	readonly narrow: boolean;
	readonly tokens: Tokens;
}

export function PreviewPanel(props: PreviewPanelProps): ReactElement {
	const { label, body, columns, rows, index, count, noColor, narrow, tokens } = props;
	const flags = `${noColor ? "no-color" : "color"} · ${narrow ? "narrow" : "wide"}`;
	// The body is a real-rendered statusline: emoji/braille-heavy ANSI whose display width Ink can
	// mismeasure relative to a real terminal. Clip every line to the popup's own text budget before
	// Ink ever sees it, so a mismeasurement can only under-fill the frame, never spill past its border.
	const textWidth = popupTextWidth(columns);
	const clipped = body
		.split("\n")
		.map((line) => truncateAnsi(line, textWidth))
		.join("\n");
	// Popup lays the title and meta out in one row (justify-content: space-between) with no minimum gap
	// of its own, so a title long enough to fill the whole row wraps onto a second line and its overflow
	// lands right where the meta starts -- a run-on like "...yo11/12" with no separator. Reserve the
	// meta's width plus a 1-column gap out of the header's own text budget, and truncate the title to
	// what's left, so the two can never collide.
	const meta = `${String(index + 1)}/${String(count)} · ${flags}`;
	const titleBudget = Math.max(1, textWidth - displayWidth(meta) - 1);
	const title = truncateAnsi(`Preview — ${label}`, titleBudget);
	return (
		<Popup
			title={title}
			meta={meta}
			footer=", . scenario · n color · w width · esc close"
			columns={columns}
			rows={rows}
			tokens={tokens}>
			<Text>{clipped}</Text>
		</Popup>
	);
}
