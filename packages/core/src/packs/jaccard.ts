// Token-set Jaccard similarity. Pure helper for the near-duplicate content gate (threshold JACCARD_DUP=0.80):
// two pack lines whose token sets overlap at or above the threshold are treated as duplicates.

export const tokenSet = (s: string): Set<string> =>
	new Set(
		s
			.toLowerCase()
			.split(/\W+/)
			.filter((t) => t.length > 0),
	);

export function jaccard(a: string, b: string): number {
	const A = tokenSet(a);
	const B = tokenSet(b);
	if (A.size === 0 && B.size === 0) return 0;
	let inter = 0;
	for (const t of A) if (B.has(t)) inter++;
	return inter / (A.size + B.size - inter);
}
