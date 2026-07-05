// The Help popup. It renders the single KEYMAP table grouped by binding group, so it is impossible for on-screen
// help to drift from the real keymap: there is no second hardcoded list. Wrapped in the shared Popup modal.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { padEndDisplay } from "../../render";
import { KEYMAP, type BindingGroup } from "../nav";
import type { Tokens } from "../theme";

import { Popup } from "./Popup";

const GROUPS: readonly BindingGroup[] = ["Navigate", "Find & preview", "Actions"];

interface HelpPopupProps {
	readonly columns: number;
	readonly rows: number;
	readonly tokens: Tokens;
}

export function HelpPopup({ columns, rows, tokens }: HelpPopupProps): ReactElement {
	return (
		<Popup title="Help" footer="esc close" columns={columns} rows={rows} tokens={tokens}>
			{GROUPS.map((group) => (
				<Box key={group} flexDirection="column" marginTop={1}>
					<Text {...tokens.accent}>{group}</Text>
					{KEYMAP.filter((b) => b.group === group).map((b) => (
						<Text key={b.keys} {...tokens.text}>
							<Text {...tokens.accent}>{padEndDisplay(b.keys, 10)}</Text>
							{"  "}
							<Text {...tokens.textMuted}>{b.label}</Text>
						</Text>
					))}
				</Box>
			))}
		</Popup>
	);
}
