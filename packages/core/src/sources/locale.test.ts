import { expect, test } from "bun:test";

import { currencyForLocale } from "./locale";

test("currencyForLocale maps a region to its currency", () => {
	expect(currencyForLocale("en-US")).toBe("USD");
	expect(currencyForLocale("en-GB")).toBe("GBP");
	expect(currencyForLocale("hi-IN")).toBe("INR");
	expect(currencyForLocale("ja-JP")).toBe("JPY");
	expect(currencyForLocale("de-DE")).toBe("EUR"); // eurozone
	expect(currencyForLocale("fr-FR")).toBe("EUR");
});

test("currencyForLocale accepts POSIX locale strings (underscore + codeset)", () => {
	expect(currencyForLocale("en_IN.UTF-8")).toBe("INR");
	expect(currencyForLocale("de_DE.UTF-8")).toBe("EUR");
});

test("currencyForLocale falls back to USD for an unknown or region-less locale", () => {
	expect(currencyForLocale("en")).toBe("USD");
	expect(currencyForLocale("xx-ZZ")).toBe("USD");
	expect(currencyForLocale("")).toBe("USD");
	expect(currencyForLocale("C")).toBe("USD");
});
