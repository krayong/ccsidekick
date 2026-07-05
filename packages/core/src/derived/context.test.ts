import { expect, test } from "bun:test";

import type { Payload, TokenSums, TranscriptScan } from "../sources";

import { deriveContext } from "./context";

const base: Payload = { workspace: {}, model: {} };

const scan = (over: { tokens?: Partial<TokenSums>; compactions?: number }): TranscriptScan => ({
	tokens: {
		input: 0,
		output: 0,
		cache_read: 0,
		cache_creation_5m: 0,
		cache_creation_1h: 0,
		...over.tokens,
	},
	messages: 0,
	compactions: over.compactions ?? 0,
	todos: [],
	burn: [],
	mtime: 0,
	size: 0,
});

const bandAt = (pct: number): string =>
	deriveContext({ ...base, context_window: { used_percentage: pct } }, scan({})).band;

test("usage fields and compactions pass through", () => {
	const payload: Payload = {
		...base,
		context_window: {
			used_percentage: 42,
			total_input_tokens: 418_000,
			context_window_size: 1_000_000,
		},
	};
	const c = deriveContext(payload, scan({ compactions: 3 }));
	expect(c.usedPct).toBe(42);
	expect(c.usedTokens).toBe(418_000);
	expect(c.windowSize).toBe(1_000_000);
	expect(c.compactions).toBe(3);
});

test("band uses the fixed context cutoffs at 33/34 and 66/67", () => {
	expect(bandAt(33)).toBe("nominal");
	expect(bandAt(34)).toBe("caution");
	expect(bandAt(66)).toBe("caution");
	expect(bandAt(67)).toBe("critical");
});

test("cacheHitPct = cache_read / (input + cache_read + cache_creation)", () => {
	// input 100, cache_read 300, cache_creation 100 (5m) ⇒ 300 / 500 = 60%
	const c = deriveContext(
		base,
		scan({ tokens: { input: 100, cache_read: 300, cache_creation_5m: 100 } }),
	);
	expect(c.cacheHitPct).toBeCloseTo(60, 6);
	// no input-class tokens ⇒ 0, not NaN
	expect(deriveContext(base, scan({})).cacheHitPct).toBe(0);
});

test("compactPressure trips above 90% (the auto-compact-imminent cutoff)", () => {
	expect(
		deriveContext({ ...base, context_window: { used_percentage: 90 } }, scan({}))
			.compactPressure,
	).toBe(false);
	expect(
		deriveContext({ ...base, context_window: { used_percentage: 91 } }, scan({}))
			.compactPressure,
	).toBe(true);
});

test("absent context_window ⇒ zeros and a nominal band", () => {
	const c = deriveContext(base, scan({}));
	expect(c.usedPct).toBe(0);
	expect(c.usedTokens).toBe(0);
	expect(c.windowSize).toBe(0);
	expect(c.band).toBe("nominal");
	expect(c.compactPressure).toBe(false);
});
