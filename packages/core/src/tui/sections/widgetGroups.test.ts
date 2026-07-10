import { expect, test } from "bun:test";

import { WIDGET_IDS } from "./forms";
import { WIDGET_GROUPS } from "./widgetGroups";

test("WIDGET_GROUPS covers every widget id exactly once", () => {
	const grouped = WIDGET_GROUPS.flatMap((g) => g.widgets);
	// no id appears in two groups
	expect(grouped.length).toBe(new Set(grouped).size);
	// the union of all group ids equals the full widget-id set
	expect(new Set(grouped)).toEqual(new Set(WIDGET_IDS));
});
