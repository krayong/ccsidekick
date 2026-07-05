import { expect, test } from "bun:test";

import { fmtLeft, ladder } from "./left";

const MIN = 60_000,
	HR = 3_600_000,
	DAY = 86_400_000,
	MONTH = 30 * DAY;

test("ladder: sub-minute shows whole seconds; negatives clamp to 0s", () => {
	expect(ladder(0)).toEqual(["0s"]);
	expect(ladder(45_000)).toEqual(["45s"]);
	expect(ladder(59_999)).toEqual(["59s"]); // floored
	expect(ladder(-5000)).toEqual(["0s"]); // clamped
});

test("ladder: minutes range shows a single minutes unit (seconds dropped)", () => {
	expect(ladder(MIN)).toEqual(["1m"]);
	expect(ladder(5 * MIN + 30_000)).toEqual(["5m"]);
	expect(ladder(59 * MIN + 59_000)).toEqual(["59m"]);
});

test("ladder: hours range shows hours + minutes, dropping a zero minute and any seconds", () => {
	expect(ladder(HR)).toEqual(["1h"]); // 0 minutes filtered out
	expect(ladder(90 * MIN)).toEqual(["1h", "30m"]);
	expect(ladder(2 * HR + 5 * MIN)).toEqual(["2h", "5m"]);
	expect(ladder(2 * HR + 30 * MIN + 45_000)).toEqual(["2h", "30m"]); // seconds ignored
});

test("ladder: day range shows days + hours", () => {
	expect(ladder(2 * DAY + 3 * HR)).toEqual(["2d", "3h"]);
	expect(ladder(DAY + 5 * HR + 30 * MIN)).toEqual(["1d", "5h"]); // top-2: minutes dropped
});

test("ladder: a day span with no whole hours falls back to days + minutes", () => {
	expect(ladder(2 * DAY + 30 * MIN)).toEqual(["2d", "30m"]); // h == 0 ⇒ show minutes, not a bare "2d"
	expect(ladder(DAY)).toEqual(["1d"]); // exactly one day: no smaller nonzero unit
	expect(ladder(3 * DAY)).toEqual(["3d"]);
});

test("ladder: month range shows months + days", () => {
	expect(ladder(MONTH)).toEqual(["1m"]); // 0 days filtered out
	expect(ladder(45 * DAY)).toEqual(["1m", "15d"]);
	expect(ladder(2 * MONTH + 3 * DAY)).toEqual(["2m", "3d"]);
});

test("fmtLeft joins the ladder parts and appends ' left'", () => {
	expect(fmtLeft(90 * MIN)).toBe("1h 30m left");
	expect(fmtLeft(2 * DAY + 3 * HR)).toBe("2d 3h left");
	expect(fmtLeft(2 * DAY + 30 * MIN)).toBe("2d 30m left");
	expect(fmtLeft(5 * MIN + 30_000)).toBe("5m left");
	expect(fmtLeft(45 * 1000)).toBe("45s left");
	expect(fmtLeft(0)).toBe("0s left");
});
