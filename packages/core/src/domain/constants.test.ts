import { expect, test } from "bun:test";

import * as C from "./constants";

test("constants match the documented values", () => {
	expect(C.MIN_RIGHT_WIDTH).toBe(53);
	expect(C.FIGURE_COLS).toBe(25);
	expect(C.FIGURE_ROWS).toBe(9);
	expect(C.EVENT_LOG_MAX).toBe(200);
	expect(C.MOOD_WINDOW_MS).toBe(300000);
	expect(C.CHAR_LINE_MAX).toBe(66);
	expect(C.POOL_TOTAL).toBe(620);
	expect(C.JACCARD_DUP).toBeCloseTo(0.8);
	expect((C as Record<string, unknown>)["GIT_TTL_MS"]).toBeUndefined();
});
