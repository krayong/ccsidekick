// Pure model for the Currency picker: the ordered code list (common codes first, then the rest
// alphabetically) and the case-insensitive filter applied as the user types. `table` is typed structurally as
// `Readonly<Record<string, number>>` — exactly the shape `readFxCached` returns — so no `RateTable` import is
// needed (it is not exported from the `sources` barrel).

export const COMMON_CODES: readonly string[] = ["EUR", "GBP", "JPY", "INR", "CNY", "CAD", "AUD"];

// USD is the immutable base currency (costs render `$0.42 (₹35)`, USD first); the picker only ever
// selects the secondary, parenthetical currency, so USD is deliberately excluded here rather than
// left in and unselectable — see `format/currency.ts`, which renders USD-as-secondary bare anyway.
export function currencyCodes(table: Readonly<Record<string, number>>): readonly string[] {
	const codes = Object.keys(table).filter((c) => c !== "USD");
	const common = COMMON_CODES.filter((c) => codes.includes(c));
	const rest = codes.filter((c) => !COMMON_CODES.includes(c)).sort();
	return [...common, ...rest];
}

export function filterCodes(codes: readonly string[], query: string): readonly string[] {
	const q = query.toLowerCase();
	return codes.filter((c) => c.toLowerCase().includes(q));
}
