const SYMBOLS: Record<string, string> = {
	USD: "$",
	EUR: "€",
	GBP: "£",
	JPY: "¥",
	INR: "₹",
	CNY: "¥",
	KRW: "₩",
	BRL: "R$",
	CAD: "$",
	AUD: "$",
	CHF: "Fr",
	RUB: "₽",
	ZAR: "R",
	MXN: "$",
	SGD: "$",
	HKD: "$",
};

export const symbolFor = (code: string): string => SYMBOLS[code] ?? `${code} `;
export const fmtUsd = (usd: number): string => `$${usd.toFixed(2)}`;
/** USD without a trailing `.00`: whole dollars render bare (`$100`), real cents keep two places (`$12.50`). */
export const fmtUsdTrim = (usd: number): string => {
	const cents = Math.round(usd * 100);
	return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
};
export const fmtLocal = (usd: number, rate: number, code: string): string =>
	`${symbolFor(code)}${Math.ceil(usd * rate)}`;

/**
 * The trailing local-currency parenthetical ` (…)` for a status field — or `""` when the line
 * currency is USD, since the conversion equals the USD figure and a `($…)` duplicate is redundant.
 */
export const localParen = (inner: string, code: string): string =>
	code === "USD" ? "" : ` (${inner})`;

export function fmtCurrency(usd: number, rate?: number, code?: string): string {
	if (rate === undefined || code === undefined || code === "USD") return fmtUsd(usd);
	return `${fmtUsd(usd)}${localParen(fmtLocal(usd, rate, code), code)}`;
}
