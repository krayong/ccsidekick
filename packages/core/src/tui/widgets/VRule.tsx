import { Box } from "ink";
import type { ReactElement } from "react";

import type { Tokens } from "../theme";

interface VRuleProps {
	readonly tokens: Tokens;
}

// A full-content-height vertical rule: an empty Box with only a right border. Yoga's default
// cross-axis alignment (align-items: stretch) grows it to the flex row's tallest sibling, so the
// "│" spans every content row (the mock's `.vr { align-self: stretch }`) without an explicit
// alignSelf prop -- ink's alignSelf typings/implementation don't support the "stretch" literal.
export function VRule({ tokens }: VRuleProps): ReactElement {
	return (
		<Box
			marginX={1}
			borderStyle="round"
			borderColor={tokens.frame.color ?? "gray"}
			borderTop={false}
			borderBottom={false}
			borderLeft={false}
		/>
	);
}
