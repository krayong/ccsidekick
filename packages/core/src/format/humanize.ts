export function humanize(n: number): string {
	if (n < 1000) return String(n);
	const k = Math.round(n / 1000);
	if (k < 1000) return `${k}k`;
	// k has rolled to 1000 (n ≥ 999_500): promote to the M format off the rounded-k basis so it prints "1M", not "1000k".
	const m = k / 1000;
	return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
}

export const pct = (n: number): string => `${Math.round(n)}%`;
