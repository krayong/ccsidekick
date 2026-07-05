// The Save & install confirm popup: the resolved scope/target list plus a paged, real-rendered statusline
// preview for one selected character at a time. The preview sits in a fixed-size ScrollBox so a wide/tall
// statusline never spills past the modal — it scrolls in both axes (ijkl or the mouse wheel). The Dashboard owns
// the current character index and scroll offsets and computes the rendered body (an ANSI string).

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import type { Tokens } from "../theme";
import { Alert, Popup, ScrollBox, popupTextWidth } from "../widgets";

import { buildSaveConfirm } from "./saveConfirm";
import type { SaveTarget } from "./saveTarget";

export interface SaveConfirmPopupProps {
	readonly targets: readonly SaveTarget[];
	readonly body: string;
	readonly charLabel: string;
	readonly index: number;
	readonly count: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly viewportRows: number;
	readonly error: string | null;
	readonly columns: number;
	readonly rows: number;
	readonly tokens: Tokens;
}

export function SaveConfirmPopup({
	targets,
	body,
	charLabel,
	index,
	count,
	offsetX,
	offsetY,
	viewportRows,
	error,
	columns,
	rows,
	tokens,
}: SaveConfirmPopupProps): ReactElement {
	const view = buildSaveConfirm(targets);
	const viewportCols = popupTextWidth(columns);
	const lines = body.split("\n");
	return (
		<Popup
			title="Save & install"
			footer="← → character · ijkl / wheel scroll · y ↵ install · esc cancel"
			meta={`${String(index + 1)}/${String(count)} characters`}
			columns={columns}
			rows={rows}
			tokens={tokens}>
			{error !== null ?
				<Alert variant="error">{error}</Alert>
			:	null}
			<Text {...tokens.text}>
				Scope: <Text {...tokens.accent}>{view.scope}</Text>
			</Text>
			{view.targets.map((t) => (
				<Text key={t} {...tokens.textMuted}>
					{"  "}
					{t}
				</Text>
			))}
			<Box flexDirection="column" marginTop={1}>
				<Text {...tokens.accent}>{charLabel}</Text>
				<ScrollBox
					width={viewportCols}
					height={Math.max(1, viewportRows)}
					offsetX={offsetX}
					offsetY={offsetY}>
					{lines.map((line, i) => (
						<Text key={i} wrap="truncate">
							{line}
						</Text>
					))}
				</ScrollBox>
			</Box>
		</Popup>
	);
}
