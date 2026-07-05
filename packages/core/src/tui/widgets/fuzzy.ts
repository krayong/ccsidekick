// A pure fzf-style matcher. `fuzzyScore` returns null when `query` is not a case-insensitive subsequence of
// `text`, else a score where higher is better: a contiguous run and an earlier match position score higher.
// `fuzzyFilter` keeps matches, ranks them by descending score then original order, and returns the items.

export function fuzzyScore(query: string, text: string): number | null {
	if (query === "") return 0;
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	let score = 0;
	let from = 0;
	let prev = -2;
	for (const ch of q) {
		const at = t.indexOf(ch, from);
		if (at === -1) return null;
		if (at === prev + 1) score += 3; // contiguous run bonus
		score += Math.max(0, 5 - at); // earlier match bonus
		prev = at;
		from = at + 1;
	}
	return score;
}

export function fuzzyFilter<T>(
	query: string,
	items: readonly T[],
	textOf: (item: T) => string,
): readonly T[] {
	if (query === "") return items;
	const scored: { readonly item: T; readonly score: number; readonly order: number }[] = [];
	items.forEach((item, order) => {
		const score = fuzzyScore(query, textOf(item));
		if (score !== null) scored.push({ item, score, order });
	});
	scored.sort((a, b) => b.score - a.score || a.order - b.order);
	return scored.map((s) => s.item);
}
