const MIN = 60_000,
	HR = 60 * MIN,
	DAY = 24 * HR,
	MONTH = 30 * DAY;

/**
 * Coarsest 1–2 nonzero units, largest first: two units from an hour up (e.g. ["2d","3h"], ["1h","30m"]), a
 * single unit below (minutes from a minute up, else seconds — so ["5m"], ["45s"]). A ≥1-day span with no whole
 * hours falls back to days + minutes (["2d","30m"]).
 */
export function ladder(ms: number): string[] {
	const total = Math.max(0, Math.floor(ms));
	const mo = Math.floor(total / MONTH);
	const d = Math.floor((total % MONTH) / DAY);
	const h = Math.floor((total % DAY) / HR);
	const m = Math.floor((total % HR) / MIN);
	const s = Math.floor((total % MIN) / 1000);

	if (total >= MONTH)
		return two([
			["m", mo],
			["d", d],
		]);

	if (total >= DAY) {
		if (h > 0)
			return two([
				["d", d],
				["h", h],
			]);

		return two([
			["d", d],
			["m", m],
		]);
	}

	if (total >= HR)
		return two([
			["h", h],
			["m", m],
		]);

	if (total >= MIN) return [`${m}m`];

	return [`${s}s`];
}

function two(parts: [string, number][]): string[] {
	const out = parts.filter(([, n]) => n > 0).map(([u, n]) => `${n}${u}`);
	return out.length > 0 ? out.slice(0, 2) : [`${parts[0]?.[1] ?? 0}${parts[0]?.[0] ?? "s"}`];
}

export const fmtLeft = (ms: number): string => `${ladder(ms).join(" ")} left`;
