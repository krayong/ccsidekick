import { expect, test } from "bun:test";

import { fixedClock, systemClock } from "./clock";

test("fixedClock is deterministic", () => {
	const c = fixedClock(1000, "UTC");
	expect(c.now()).toBe(1000);
	expect(c.timezone()).toBe("UTC");
});

test("fixedClock defaults timezone to UTC", () => {
	expect(fixedClock(0).timezone()).toBe("UTC");
});

test("systemClock reads wall-clock time and a timezone", () => {
	const before = Date.now();
	const seen = systemClock.now();
	const after = Date.now();
	expect(seen).toBeGreaterThanOrEqual(before);
	expect(seen).toBeLessThanOrEqual(after);
	expect(typeof systemClock.timezone()).toBe("string");
});
