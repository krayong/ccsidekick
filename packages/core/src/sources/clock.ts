export interface Clock {
	now(): number;
	timezone(): string;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const fixedClock = (nowMs: number, tz = "UTC"): Clock => ({
	now: () => nowMs,
	timezone: () => tz,
});

/**
 * The clock the render path should use: `systemClock` normally, but a `fixedClock` pinned to `CCSIDEKICK_NOW`
 * (epoch milliseconds) when that env var holds a finite number. Pinning makes a render fully reproducible — the
 * figure shimmer phase and every countdown derive from `clock.now()` — so a generated snapshot (e.g. a pack's
 * README statusline shot) stops churning on every run. `CCSIDEKICK_TZ` optionally pins the timezone (default UTC).
 */
export const resolveClock = (env: NodeJS.ProcessEnv): Clock => {
	const raw = env["CCSIDEKICK_NOW"];
	const nowMs = raw === undefined ? NaN : Number(raw);
	if (raw === undefined || raw.trim() === "" || !Number.isFinite(nowMs)) return systemClock;
	return fixedClock(nowMs, env["CCSIDEKICK_TZ"] ?? "UTC");
};
