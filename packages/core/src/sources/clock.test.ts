import { expect, test } from "bun:test";

import { fixedClock, resolveClock, systemClock } from "./clock";

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

test("resolveClock pins to CCSIDEKICK_NOW (epoch ms), defaulting the timezone to UTC", () => {
	const c = resolveClock({ CCSIDEKICK_NOW: "1700000000000" });
	expect(c.now()).toBe(1700000000000);
	expect(c.timezone()).toBe("UTC");
});

test("resolveClock honors CCSIDEKICK_TZ alongside a pinned now", () => {
	const c = resolveClock({ CCSIDEKICK_NOW: "1700000000000", CCSIDEKICK_TZ: "America/New_York" });
	expect(c.timezone()).toBe("America/New_York");
});

test("resolveClock falls back to systemClock when CCSIDEKICK_NOW is absent", () => {
	const before = Date.now();
	const seen = resolveClock({}).now();
	const after = Date.now();
	expect(seen).toBeGreaterThanOrEqual(before);
	expect(seen).toBeLessThanOrEqual(after);
});

test("resolveClock ignores a non-numeric or empty CCSIDEKICK_NOW", () => {
	for (const bad of ["", "not-a-number", "   "]) {
		const before = Date.now();
		const seen = resolveClock({ CCSIDEKICK_NOW: bad }).now();
		const after = Date.now();
		expect(seen).toBeGreaterThanOrEqual(before);
		expect(seen).toBeLessThanOrEqual(after);
	}
});
