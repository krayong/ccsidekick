// The Theme section on the three-column Rail: Themes and Options categories. Themes lists the catalog with the
// active theme marked; a theme row's detail shows the live mini-statusline (computed by the Dashboard) plus an
// in-house swatch strip -- the hue ramp, signal dots, and separator glyph in their real xterm-256 colors. Options
// lists exactly the two theme settings (Banding, Mood shift); a setting row's detail shows its current value and
// a one-line explanation. Presentational only: the mini-statusline body is passed in; this does no I/O.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import type { ThemeData } from "../../data";
import { CHARACTER_THEME } from "../../render";
import { hexForXterm, type GlyphSet, type Tokens } from "../theme";
import { Rail, type FieldSpec, type MillerItem, type RailState } from "../widgets";

// The Theme-Options list/detail builds its rows as `${label}: ${value}`; a toggle field's on/off
// value is rendered through the same glyph+word indicator as FieldRow's Value so on/off reads the
// same wherever it appears as a plain label:value pair.
function settingValue(f: FieldSpec, glyphs: GlyphSet): string {
	return f.kind === "toggle" && (f.value === "on" || f.value === "off") ?
			`${f.value === "on" ? glyphs.tabActive : glyphs.tabInactive} ${f.value}`
		:	f.value;
}

export interface ThemeSectionProps {
	readonly state: RailState;
	readonly themeKeys: readonly string[];
	readonly themes: Readonly<Record<string, ThemeData>>;
	readonly activeTheme: string;
	readonly settingRows: readonly FieldSpec[];
	readonly detailBody: string;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}

const SETTING_EXPLAIN: Record<string, string> = {
	banding: "solid paints one flat color; cycle sweeps the hue ramp",
	mood_shift: "tints the figure by mood, color only",
};

function Swatch({
	theme,
	glyphs,
}: {
	readonly theme: ThemeData;
	readonly glyphs: GlyphSet;
}): ReactElement {
	return (
		<Box flexDirection="column">
			<Box>
				{theme.hues.map((h, i) => (
					<Text key={`hue-${String(i)}`} color={hexForXterm(h)}>
						██
					</Text>
				))}
			</Box>
			<Box>
				<Text color={hexForXterm(theme.signals.nominal)}>● </Text>
				<Text color={hexForXterm(theme.signals.caution)}>● </Text>
				<Text color={hexForXterm(theme.signals.critical)}>● </Text>
				<Text color={hexForXterm(theme.separator)}>{glyphs.vRule}</Text>
			</Box>
		</Box>
	);
}

export function ThemeSection(props: ThemeSectionProps): ReactElement {
	const { state, themeKeys, themes, activeTheme, settingRows, detailBody, rows, tokens, glyphs } =
		props;

	const themeItems: readonly MillerItem[] = themeKeys.map((key) => ({
		id: key,
		label: `${key === activeTheme ? glyphs.tabActive : glyphs.tabInactive} ${
			key === CHARACTER_THEME ? "Match character" : (themes[key]?.displayName ?? key)
		}`,
	}));
	const settingItems: readonly MillerItem[] = settingRows.map((f) => ({
		id: f.id,
		label: `${f.label}: ${settingValue(f, glyphs)}`,
	}));

	const themeIdx = Math.min(state.itemCursor, themeKeys.length - 1);
	const selectedThemeKey = themeKeys[themeIdx] ?? themeKeys[0] ?? "houston";
	const selectedTheme = themes[selectedThemeKey];
	const themeDetail: ReactNode =
		selectedThemeKey === CHARACTER_THEME ?
			<Box flexDirection="column">
				<Text {...tokens.textMuted}>Follows the active character&apos;s palette.</Text>
				{detailBody !== "" ?
					<Box marginTop={1}>
						<Text>{detailBody}</Text>
					</Box>
				:	null}
			</Box>
		: selectedTheme === undefined ? null
		: <Box flexDirection="column">
				<Swatch theme={selectedTheme} glyphs={glyphs} />
				{detailBody !== "" ?
					<Box marginTop={1}>
						<Text>{detailBody}</Text>
					</Box>
				:	null}
			</Box>;

	const settingIdx = Math.min(state.itemCursor, settingRows.length - 1);
	const selectedSetting = settingRows[settingIdx];
	const settingsDetail: ReactNode = (
		<Box flexDirection="column">
			<Text {...tokens.accent}>
				{selectedSetting?.label ?? ""}:{" "}
				{selectedSetting ? settingValue(selectedSetting, glyphs) : ""}
			</Text>
			<Text {...tokens.textMuted}>{SETTING_EXPLAIN[selectedSetting?.id ?? ""] ?? ""}</Text>
		</Box>
	);

	const items: readonly MillerItem[] = state.catCursor === 0 ? themeItems : settingItems;
	const detail: ReactNode = state.catCursor === 0 ? themeDetail : settingsDetail;

	return (
		<Rail
			categories={["Themes", "Options"]}
			items={items}
			detail={detail}
			state={state}
			rows={rows}
			tokens={tokens}
			glyphs={glyphs}
		/>
	);
}
