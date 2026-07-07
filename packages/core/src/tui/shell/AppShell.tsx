// The presentational shell: a sticky header (brand, config dir, scope, dirty state), the section navigation
// (a left sidebar), the content region, and a sticky hint-bar footer.
// It reads only tokens and glyphs, takes no input, and measures no size; the stateful Dashboard drives it.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import { SECTIONS, hintsFor, type NavState } from "../nav";
import type { GlyphSet, Tokens } from "../theme";
import { VRule } from "../widgets";

interface SidebarView {
	readonly sections: readonly number[]; // original SECTIONS indices, in filtered order
	readonly cursor: number; // index into `sections`
}

// 2 border rows + header + header divider + footer divider + hint bar; an open overlay suppresses
// the sidebar and content.
export const POPUP_CHROME_ROWS = 6;

// The non-overlay content region loses more than the shell's 4 chrome rows: Content (below) also renders its
// own section-title eyebrow row plus a marginTop={1} spacer above the children. 2 border + header + hint bar
// + eyebrow + marginTop = 6.
export const CONTENT_CHROME_ROWS = 6;

// The non-overlay content region's horizontal chrome: the shell's paddingX + border (4) + the sidebar's
// expanded width (18) + the vertical rule's margin+border (3) + Content's own paddingLeft (2) = 27. Sized
// against the sidebar's expanded width even though it collapses to 4 at the narrow breakpoint's content zone
// -- that collapse only frees more columns, so a section sizing itself against this wider case never overflows.
export const CONTENT_CHROME_COLS = 27;

export interface AppShellProps {
	readonly nav: NavState;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
	readonly configDir: string;
	readonly scope: "global" | "local" | "mixed";
	readonly dirty: boolean;
	readonly children?: ReactNode;
	readonly overlay?: ReactElement;
	readonly sidebarView?: SidebarView;
	readonly columns: number;
	readonly rows: number;
	readonly collapsed?: boolean;
}

function Header({ tokens, configDir, scope, dirty }: AppShellProps): ReactElement {
	return (
		<Box justifyContent="space-between" flexShrink={0}>
			<Text {...tokens.accent}>ccsidekick</Text>
			<Box>
				<Text {...tokens.textMuted}>{configDir} </Text>
				<Text {...tokens.text}>[{scope}] </Text>
				{dirty ?
					<Text {...tokens.caution}>● unsaved</Text>
				:	<Text {...tokens.nominal}>✓ saved</Text>}
			</Box>
		</Box>
	);
}

function SidebarItem({
	index,
	name,
	active,
	tokens,
	glyphs,
}: {
	readonly index: number;
	readonly name: string;
	readonly active: boolean;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}): ReactElement {
	const marker = active ? glyphs.marker : glyphs.markerBlank;
	return (
		<Text {...(active ? tokens.accent : tokens.text)}>
			{index + 1} {marker} {name}
		</Text>
	);
}

function CollapsedSidebarItem({
	index,
	active,
	tokens,
	glyphs,
}: {
	readonly index: number;
	readonly active: boolean;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}): ReactElement {
	return (
		<Text {...(active ? tokens.accent : tokens.text)}>
			{index + 1}
			{active ? glyphs.marker : " "}
		</Text>
	);
}

// At the narrow tier, once focus leaves the sidebar for the content zone, the section list collapses to
// numbered markers (and its Box narrows from 18 to 4 columns) so the three-column Rail gets real room.
function Sidebar({ nav, tokens, glyphs, sidebarView, collapsed }: AppShellProps): ReactElement {
	const active = nav.zone === "sidebar";
	const width = collapsed === true ? 4 : 18;
	if (sidebarView !== undefined) {
		return (
			<Box flexDirection="column" width={width}>
				{sidebarView.sections.map((sec, i) =>
					collapsed === true ?
						<CollapsedSidebarItem
							key={SECTIONS[sec] ?? String(sec)}
							index={i}
							active={i === sidebarView.cursor}
							tokens={tokens}
							glyphs={glyphs}
						/>
					:	<SidebarItem
							key={SECTIONS[sec] ?? String(sec)}
							index={i}
							name={SECTIONS[sec] ?? ""}
							active={i === sidebarView.cursor}
							tokens={tokens}
							glyphs={glyphs}
						/>,
				)}
			</Box>
		);
	}
	return (
		<Box flexDirection="column" width={width}>
			{SECTIONS.map((name, i) =>
				collapsed === true ?
					<CollapsedSidebarItem
						key={name}
						index={i}
						active={active && i === nav.section}
						tokens={tokens}
						glyphs={glyphs}
					/>
				:	<SidebarItem
						key={name}
						index={i}
						name={name}
						active={active && i === nav.section}
						tokens={tokens}
						glyphs={glyphs}
					/>,
			)}
		</Box>
	);
}

function HintBar({ nav, tokens }: AppShellProps): ReactElement {
	return (
		<Box>
			{hintsFor(nav).map((h) => (
				<Text key={h.key + h.label} {...tokens.textMuted}>
					{h.key} {h.label}
					{"   "}
				</Text>
			))}
		</Box>
	);
}

function Content({ nav, tokens, glyphs, children }: AppShellProps): ReactElement {
	// When content is focused, the eyebrow carries the marker glyph and accent so focus survives NO_COLOR (T1)
	// without adding a panel box, which the one-border density rule reserves for the active overlay (a popup
	// such as Preview, Find, or Help).
	const focused = nav.zone === "content";
	const eyebrow = `${focused ? `${glyphs.marker} ` : ""}${SECTIONS[nav.section]?.toUpperCase() ?? ""}`;
	// The section heading is always accent-highlighted (not dimmed with the sidebar), painted directly with no
	// per-change fade: a fade re-rendered the heading dim→accent on every section switch, which read as a flicker.
	return (
		<Box flexDirection="column" flexGrow={1} paddingLeft={2}>
			<Text {...tokens.accent}>{eyebrow}</Text>
			<Box marginTop={1}>{children}</Box>
		</Box>
	);
}

export function AppShell(props: AppShellProps): ReactElement {
	const { tokens, columns, rows } = props;
	return (
		<Box
			width={columns}
			height={rows}
			flexDirection="column"
			paddingX={1}
			overflow="hidden"
			borderStyle="round"
			borderColor={tokens.frame.color ?? "gray"}>
			<Header {...props} />
			{props.overlay !== undefined ?
				props.overlay
			:	<>
					<Box marginTop={0} flexDirection="row" flexGrow={1} flexShrink={0}>
						<Sidebar {...props} />
						<VRule tokens={tokens} />
						<Content {...props} />
					</Box>
				</>
			}
			<Box flexShrink={0}>
				<HintBar {...props} />
			</Box>
		</Box>
	);
}
