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
