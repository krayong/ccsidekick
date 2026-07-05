// Renders a section's fields, windowed to a row budget so a long list (the 35-row Statusline) scrolls in place.
// A dim "N more" affordance marks hidden rows above and below.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { scrollWindow } from "..";
import type { GlyphSet, Tokens } from "../theme";
import { FieldRow, type FieldSpec } from "../widgets";

export interface FormSectionProps {
	readonly fields: readonly FieldSpec[];
	readonly cursor: number;
	readonly editing: boolean;
	readonly buffer: string;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

function More({
	dir,
	count,
	tokens,
}: {
	dir: "↑" | "↓";
	count: number;
	tokens: Tokens;
}): ReactElement | null {
	if (count <= 0) return null;
	return (
		<Text {...tokens.textMuted}>
			{"  "}
			{dir} {count} more
		</Text>
	);
}

export function FormSection(props: FormSectionProps): ReactElement {
	const { fields, cursor, editing, buffer, rows, tokens, glyphs } = props;
	// Reserve one row each for the more-above / more-below affordances.
	const viewport = Math.max(1, rows - 2);
	const { start, end } = scrollWindow(fields.length, cursor, viewport);
	return (
		<Box flexDirection="column">
			<More dir="↑" count={start} tokens={tokens} />
			{fields.slice(start, end).map((field, i) => {
				const index = start + i;
				return (
					<FieldRow
						key={field.id}
						field={field}
						active={index === cursor}
						editing={editing && index === cursor}
						buffer={buffer}
						tokens={tokens}
						glyphs={glyphs}
					/>
				);
			})}
			<More dir="↓" count={fields.length - end} tokens={tokens} />
		</Box>
	);
}
