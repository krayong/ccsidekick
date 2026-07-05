// The Statusline section on the three-column Rail: Format plus the six widget groups. Format's two rows are
// the line-level Currency and Budget fields (Budget shows the live edit buffer + caret while editing, never
// the stale stored value); every other group lists its widgets with an on/off pill. The detail pane explains
// the highlighted widget, or the active Format field. Presentational only: the Dashboard owns the RailState,
// the editing buffer, and the config.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import type { Config } from "../../sources";
import type { GlyphSet, Tokens } from "../theme";
import { Rail, type MillerItem, type RailState } from "../widgets";

import { statuslineFields } from "./forms";
import { WIDGET_DESCRIPTIONS, WIDGET_GROUPS } from "./widgetGroups";

export interface StatuslineSectionProps {
	readonly state: RailState;
	readonly config: Config;
	readonly editing: boolean;
	readonly buffer: string;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

const FORMAT_EXPLAIN: Readonly<Record<"currency" | "budget", string>> = {
	currency: "The currency code used to format every money widget.",
	budget: "A monthly USD budget; cost widgets show progress against it when set.",
};

export function StatuslineSection(props: StatuslineSectionProps): ReactElement {
	const { state, config, editing, buffer, rows, tokens, glyphs } = props;

	const group = WIDGET_GROUPS[state.catCursor] ?? WIDGET_GROUPS[0];
	const isFormat = group?.name === "Format";

	const fmtFields = statuslineFields(config);
	const currencyValue = fmtFields[0]?.value ?? "";
	const budgetValue = fmtFields[1]?.value ?? "";
	const budgetDisplay = state.itemCursor === 1 && editing ? `${buffer}█` : budgetValue;

	const formatItems: readonly MillerItem[] = [
		{ id: "currency", label: `Currency: ${currencyValue}` },
		{ id: "budget", label: `Budget (USD/mo): ${budgetDisplay}` },
	];
	const widgets = group?.widgets ?? [];
	const widgetItems: readonly MillerItem[] = widgets.map((id) => ({
		id,
		label: `${config.line.widgets[id] ? glyphs.tabActive : glyphs.tabInactive} ${id}`,
	}));

	const items: readonly MillerItem[] = isFormat ? formatItems : widgetItems;

	const formatIdx = Math.min(state.itemCursor, 1);
	const formatDetail: ReactNode = (
		<Box flexDirection="column">
			<Text {...tokens.accent}>{formatIdx === 1 ? "Budget" : "Currency"}</Text>
			<Text {...tokens.textMuted}>
				{formatIdx === 1 ? FORMAT_EXPLAIN.budget : FORMAT_EXPLAIN.currency}
			</Text>
		</Box>
	);

	const widgetIdx = Math.min(state.itemCursor, widgets.length - 1);
	const selectedWidget = widgets[widgetIdx];
	const widgetDetail: ReactNode =
		selectedWidget === undefined ? null : (
			<Box flexDirection="column">
				<Text {...tokens.accent}>{selectedWidget}</Text>
				<Text {...tokens.textMuted}>{WIDGET_DESCRIPTIONS[selectedWidget]}</Text>
			</Box>
		);

	const detail: ReactNode = isFormat ? formatDetail : widgetDetail;

	return (
		<Rail
			categories={WIDGET_GROUPS.map((g) => g.name)}
			items={items}
			detail={detail}
			state={state}
			rows={rows}
			tokens={tokens}
			glyphs={glyphs}
		/>
	);
}
