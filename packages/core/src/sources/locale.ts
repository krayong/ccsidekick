// Pick a sensible default display currency from the runtime locale, falling back to USD. Only chooses the
// `[statusline].currency` default when the user hasn't set one; the fx table handles the actual conversion. Pure and
// Node-portable (reads the locale via Intl, or accepts an explicit string for tests).

// Region (ISO 3166-1 alpha-2) → currency (ISO 4217). A curated common set; anything unlisted falls back to USD.
const EUROZONE = [
	"AT",
	"BE",
	"HR",
	"CY",
	"EE",
	"FI",
	"FR",
	"DE",
	"GR",
	"IE",
	"IT",
	"LV",
	"LT",
	"LU",
	"MT",
	"NL",
	"PT",
	"SK",
	"SI",
	"ES",
];

const REGION_CURRENCY: Readonly<Record<string, string>> = {
	US: "USD",
	GB: "GBP",
	IN: "INR",
	JP: "JPY",
	CN: "CNY",
	CA: "CAD",
	AU: "AUD",
	CH: "CHF",
	SE: "SEK",
	NO: "NOK",
	DK: "DKK",
	BR: "BRL",
	RU: "RUB",
	KR: "KRW",
	MX: "MXN",
	ZA: "ZAR",
	SG: "SGD",
	HK: "HKD",
	NZ: "NZD",
	AE: "AED",
	SA: "SAR",
	TR: "TRY",
	PL: "PLN",
	TH: "THB",
	ID: "IDR",
	MY: "MYR",
	PH: "PHP",
	VN: "VND",
	NG: "NGN",
	IL: "ILS",
	...Object.fromEntries(EUROZONE.map((r) => [r, "EUR"])),
};

/** Extract the region subtag from a BCP-47 or POSIX locale (`en-US`, `en_IN.UTF-8`, …); "" when absent. */
function regionOf(locale: string): string {
	const match = /[-_]([a-z]{2})(?:[-_.@]|$)/i.exec(locale);
	return match?.[1] !== undefined ? match[1].toUpperCase() : "";
}

/** The default currency for a locale string; USD when the region is unknown or missing. */
export function currencyForLocale(locale: string): string {
	return REGION_CURRENCY[regionOf(locale)] ?? "USD";
}

/** The runtime locale, or "en-US" if the environment doesn't expose one. */
function detectLocale(): string {
	try {
		return new Intl.DateTimeFormat().resolvedOptions().locale;
	} catch {
		return "en-US";
	}
}

/** The default `[statusline].currency` when the user hasn't configured one: derived from the runtime locale. */
export const defaultCurrency = (): string => currencyForLocale(detectLocale());
