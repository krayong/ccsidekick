// The presentational top-tab strip. The active tab is accent-colored, matching the app's other selection cues
// (SidebarItem, Rail) rather than an inverse block, so it reads at every capability tier. Holds no state and
// takes no input; the parent owns the active index and routes the keys.

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import type { Tokens } from "../theme";

interface TabBarProps {
	readonly tabs: readonly string[];
	readonly active: number;
	readonly tokens: Tokens;
}

export function TabBar(props: TabBarProps): ReactElement {
	const { tabs, active, tokens } = props;
	return (
		<Box>
			{tabs.map((tab, i) => (
				<Text key={tab} {...(i === active ? tokens.accent : tokens.textMuted)}>
					{" "}
					{tab}{" "}
				</Text>
			))}
		</Box>
	);
}
