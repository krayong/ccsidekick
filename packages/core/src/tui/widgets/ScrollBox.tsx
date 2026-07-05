// A fixed-size viewport that clips its content and scrolls it by a row/column offset. The outer box is sized to
// the viewport and hides overflow; the inner box holds the full content and is shifted up/left by the offsets
// via negative margins, so the visible window is content[offsetY .. offsetY+height, offsetX .. offsetX+width].
// The caller owns and clamps the offsets (see clampScroll). Pure presentation: no state, no input.

import { Box } from "ink";
import type { ReactElement, ReactNode } from "react";

export interface ScrollBoxProps {
	readonly width: number;
	readonly height: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly children: ReactNode;
}

export function ScrollBox({
	width,
	height,
	offsetX,
	offsetY,
	children,
}: ScrollBoxProps): ReactElement {
	return (
		<Box width={width} height={height} flexDirection="column" overflow="hidden">
			<Box flexDirection="column" flexShrink={0} marginTop={-offsetY} marginLeft={-offsetX}>
				{children}
			</Box>
		</Box>
	);
}
