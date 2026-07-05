// A centered rounded-border modal: a pinned title row, a clipping body, and a pinned keybindings footer. The
// outer Box is a COLUMN (so flexShrink acts on the vertical axis) sized to the region it is given (columns x
// rows) with justifyContent center, so a short modal floats centered and a tall one shrinks to fit. The modal
// box has flexShrink 1; inside it the title and footer sit in flexShrink 0 boxes (never clipped) and only the
// body is flexShrink 1 + overflow hidden, so a body taller than the region clips while the title and footer
// stay visible. Callers pass the BODY region size (rows minus AppShell chrome), never the full terminal.
// Pure presentation.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import type { Tokens } from "../theme";

// The columns a popup's frame must give up to sit safely inside AppShell: AppShell's own border +
// paddingX steal 4 columns from every overlay (2 border cols + 2 paddingX cols — the same "4" the
// preview overlay's own comment already accounts for), plus 2 columns of margin. That margin exists
// because a real terminal and Ink can disagree on the display width of wide glyphs (the emoji/braille
// figures a rendered statusline carries); an exact columns-4 fit would still let that mismeasurement
// push the border a column or two past the shell's visible edge, so the frame is pinned a little
// short of the true limit instead of flush against it.
export const POPUP_CHROME_COLS = 6;

/** The popup frame's own width for a given raw `columns`, floored so a very narrow terminal still gets
 * a usable box (it shrinks further via flexShrink if even that doesn't fit). */
const popupFrameWidth = (columns: number): number => Math.max(20, columns - POPUP_CHROME_COLS);

/** The plain-text budget inside the frame: its own border (2 cols) and paddingX (2 cols) eat 4 of
 * `popupFrameWidth`'s columns. Callers that hand Popup pre-rendered ANSI text (e.g. a real statusline
 * render) should truncate each line to this width themselves — Popup pins the frame but cannot inspect
 * arbitrary `children` to truncate their text for them. */
export const popupTextWidth = (columns: number): number =>
	Math.max(1, popupFrameWidth(columns) - 4);

interface PopupProps {
	readonly title: string;
	readonly footer: string;
	readonly columns: number;
	readonly rows: number;
	readonly tokens: Tokens;
	readonly children: ReactNode;
	readonly meta?: string;
}

export function Popup({
	title,
	footer,
	columns,
	rows,
	tokens,
	children,
	meta,
}: PopupProps): ReactElement {
	const frameColor = tokens.frame.color ?? "gray";
	// The centering region is the AppShell's INNER width, not the full terminal: AppShell wraps this overlay in a
	// bordered box with paddingX 1, eating 4 columns (2 border + 2 padding). Centering in the full `columns` would
	// overflow that inner region on the right, and AppShell's overflow:hidden would clip it — shoving the popup
	// right so its border merges with the app frame. `columns - 4` centers the frame symmetrically inside.
	const regionWidth = Math.max(20, columns - 4);
	return (
		<Box
			width={regionWidth}
			height={rows}
			flexDirection="column"
			justifyContent="center"
			alignItems="center">
			<Box
				width={popupFrameWidth(columns)}
				flexDirection="column"
				flexShrink={1}
				borderStyle="round"
				borderColor={frameColor}
				paddingX={1}
				overflow="hidden">
				<Box
					flexShrink={0}
					justifyContent="space-between"
					borderStyle="round"
					borderColor={frameColor}
					borderTop={false}
					borderLeft={false}
					borderRight={false}>
					<Text {...tokens.accent} bold>
						{title}
					</Text>
					{meta !== undefined ?
						<Text {...tokens.textMuted}>{meta}</Text>
					:	null}
				</Box>
				<Box flexDirection="column" flexShrink={1} overflow="hidden">
					<Box flexDirection="column" flexShrink={0}>
						{children}
					</Box>
				</Box>
				<Box
					flexShrink={0}
					borderStyle="round"
					borderColor={frameColor}
					borderBottom={false}
					borderLeft={false}
					borderRight={false}>
					<Text {...tokens.textMuted}>{footer}</Text>
				</Box>
			</Box>
		</Box>
	);
}
