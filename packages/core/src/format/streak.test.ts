import { expect, test } from "bun:test";

import { streak } from "./streak";

test("streak", () => {
	expect(streak(0)).toBe("0");
	expect(streak(1)).toBe("1-day streak");
	expect(streak(7)).toBe("7-day streak");
});
