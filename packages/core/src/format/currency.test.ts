import { expect, test } from "bun:test";

import { symbolFor, fmtUsd, fmtUsdTrim, fmtLocal, fmtCurrency, localParen } from "./currency";

test("symbol map", () => {
	expect(symbolFor("INR")).toBe("₹");
	expect(symbolFor("USD")).toBe("$");
	expect(symbolFor("ZZZ")).toBe("ZZZ ");
});
test("formatting", () => {
	expect(fmtUsd(1.234)).toBe("$1.23");
	expect(fmtLocal(1.23, 95, "INR")).toBe("₹117"); // ceil(116.85)
	expect(fmtCurrency(1.23, 95, "INR")).toBe("$1.23 (₹117)");
	expect(fmtCurrency(1.23, 1, "USD")).toBe("$1.23");
});
test("localParen wraps the local text, but suppresses it entirely for USD", () => {
	expect(localParen("₹117", "INR")).toBe(" (₹117)");
	expect(localParen("$1", "USD")).toBe(""); // no redundant duplicate when the line currency is USD
});
test("fmtUsdTrim drops a zero decimal, keeps real cents", () => {
	expect(fmtUsdTrim(0)).toBe("$0");
	expect(fmtUsdTrim(100)).toBe("$100");
	expect(fmtUsdTrim(12.5)).toBe("$12.50");
	expect(fmtUsdTrim(12.34)).toBe("$12.34");
	expect(fmtUsdTrim(100.001)).toBe("$100"); // rounds to whole cents ⇒ no ".00"
});
