import { expect, test } from "bun:test";

import { fmtAgo, fmtGap } from "./ago";

const MIN = 60_000;
test("fmtAgo", () => {
	expect(fmtAgo(30 * 1000)).toBe("just now");
	expect(fmtAgo(90 * MIN)).toBe("1h 30m ago");
});
test("fmtGap has no suffix", () => {
	expect(fmtGap(3 * 86_400_000)).toBe("3d");
});
