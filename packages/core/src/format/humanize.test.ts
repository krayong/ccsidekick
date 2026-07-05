import { expect, test } from "bun:test";

import { humanize, pct } from "./humanize";

test("humanize tokens", () => {
	expect(humanize(999)).toBe("999");
	expect(humanize(1500)).toBe("2k");
	expect(humanize(1_000_000)).toBe("1M");
	expect(humanize(1_500_000)).toBe("1.5M");
});
test("humanize rolls 999.5k and up to 1M instead of 1000k", () => {
	expect(humanize(999_999)).toBe("1M");
	expect(humanize(999_500)).toBe("1M");
	expect(humanize(999_499)).toBe("999k");
	expect(humanize(1_000_000)).toBe("1M");
});
test("pct rounds to a whole percent", () => {
	expect(pct(42.7)).toBe("43%");
	expect(pct(0)).toBe("0%");
});
