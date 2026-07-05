// The row renderer for one field. Focus is redundant (survives NO_COLOR): the active row carries the `❯` marker
// and an accent label; an editing field shows the live buffer and a block caret. Inactive rows are plain
// label/value.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import type { GlyphSet, Tokens } from "../theme";

import type { FieldSpec } from "./fieldModel";

export interface FieldRowProps {
	readonly field: FieldSpec;
	readonly active: boolean;
	readonly editing: boolean;
	readonly buffer: string;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

function Value({ field, editing, buffer, tokens, glyphs }: FieldRowProps): ReactElement {
	if (editing) {
		return (
			<Text {...tokens.text}>
				{buffer}
				<Text {...tokens.accent}>█</Text>
			</Text>
		);
	}
	if (field.kind === "toggle" && (field.value === "on" || field.value === "off")) {
		const on = field.value === "on";
		return (
			<Text {...(on ? tokens.nominal : tokens.textMuted)}>
				{on ? glyphs.tabActive : glyphs.tabInactive} {field.value}
			</Text>
		);
	}
	return <Text {...tokens.text}>{field.value}</Text>;
}

export function FieldRow(props: FieldRowProps): ReactElement {
	const { field, active, tokens, glyphs } = props;
	return (
		<Box>
			<Text {...(active ? tokens.accent : tokens.text)}>
				{active ? glyphs.marker : glyphs.markerBlank}{" "}
			</Text>
			<Text {...(active ? tokens.accent : tokens.textMuted)}>{field.label}: </Text>
			<Value {...props} />
		</Box>
	);
}
