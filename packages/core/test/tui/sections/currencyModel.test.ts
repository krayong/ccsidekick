import { expect, test } from "bun:test";

import { currencyCodes, filterCodes, COMMON_CODES } from "../../../src/tui/sections";

const table = { USD: 1, INR: 83, EUR: 0.9, ZAR: 18, AED: 3.67 };

test("common codes lead, then the rest alphabetically, no duplicates", () => {
	const codes = currencyCodes(table);
	expect(codes.slice(0, COMMON_CODES.filter((c) => c in table).length)).toEqual(
		COMMON_CODES.filter((c) => c in table),
	);
	expect(new Set(codes).size).toBe(codes.length);
	expect(codes).toContain("ZAR");
});

test("typing filters the list case-insensitively by prefix or substring", () => {
	expect(filterCodes(currencyCodes(table), "in")).toContain("INR");
	expect(filterCodes(currencyCodes(table), "zzz")).toHaveLength(0);
});

test("USD is not offered as a selectable secondary code", () => {
	const codes = currencyCodes({ USD: 1, EUR: 0.9, INR: 83, GBP: 0.8 });
	expect(codes).not.toContain("USD");
	expect(codes).toContain("EUR");
	expect(codes).toContain("INR");
});
