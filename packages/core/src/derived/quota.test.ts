import { expect, test } from "bun:test";

import { type BalanceSnapshot, type Payload, type UsageData, fixedClock } from "../sources";

import { deriveQuota } from "./quota";

const base: Payload = { workspace: {}, model: {} };
const NOW = 1_000_000_000_000;
const clock = fixedClock(NOW);

const HR = 3_600_000;
const DAY = 86_400_000;

test("payload rate_limits: used_percentage + epoch-seconds resets_at populate block and weekly", () => {
	const payload: Payload = {
		...base,
		rate_limits: {
			five_hour: { used_percentage: 18, resets_at: (NOW + 2 * HR) / 1000 },
			seven_day: { used_percentage: 61, resets_at: (NOW + 3 * DAY) / 1000 },
		},
	};
	const q = deriveQuota(payload, null, null, clock);
	expect(q.block?.usedPct).toBe(18);
	expect(q.weekly?.usedPct).toBe(61);
	// countdown computed from resets_at * 1000 differenced against now
	expect(q.block?.resetIn).toBe("2h left");
	expect(q.weekly?.resetIn).toBe("3d left");
	// pace-vs-runway: 18% used 60% through the 5h window ⇒ r=0.3 nominal; 61% used ~57% through the 7d window
	// ⇒ r≈1.07 caution.
	expect(q.block?.band).toBe("nominal");
	expect(q.weekly?.band).toBe("caution");
});

test("block band uses pace-vs-runway over the 5h window, not the raw percentage", () => {
	// 50% used exactly halfway through the 5h window ⇒ on pace ⇒ nominal. The raw/context band at 50% is
	// caution, so this only passes when resets_at, the 5h window, and now are all threaded into the pace ratio.
	const payload: Payload = {
		...base,
		rate_limits: { five_hour: { used_percentage: 50, resets_at: (NOW + 2.5 * HR) / 1000 } },
	};
	expect(deriveQuota(payload, null, null, clock).block?.band).toBe("nominal");
});

test("OAuth usage: utilization + epoch-ms resets_at populate the same with a computed countdown", () => {
	const usage: UsageData = {
		rate_limits: {
			five_hour: { utilization: 40, resets_at: NOW + 1 * HR },
			seven_day: { utilization: 22, resets_at: NOW + 2 * DAY },
		},
	};
	const q = deriveQuota(base, usage, null, clock);
	expect(q.block?.usedPct).toBe(40);
	expect(q.weekly?.usedPct).toBe(22);
	expect(q.block?.resetIn).toBe("1h left");
	expect(q.weekly?.resetIn).toBe("2d left");
});

test("payload is preferred over the OAuth usage source per window", () => {
	const payload: Payload = {
		...base,
		rate_limits: { five_hour: { used_percentage: 10, resets_at: (NOW + HR) / 1000 } },
	};
	const usage: UsageData = {
		rate_limits: { five_hour: { utilization: 99, resets_at: NOW + HR } },
	};
	const q = deriveQuota(payload, usage, null, clock);
	expect(q.block?.usedPct).toBe(10);
});

test("missing resets_at ⇒ direct band and a hidden countdown", () => {
	const usage: UsageData = { rate_limits: { five_hour: { utilization: 65 } } };
	const q = deriveQuota(base, usage, null, clock);
	expect(q.block?.resetIn).toBeUndefined();
	// no resets_at ⇒ context-band fallback: 65 ⇒ caution; countdown hidden
	expect(q.block?.band).toBe("caution");
});

test("PAYG from extra_usage, gated on is_enabled, credits ÷ 100", () => {
	const enabled: UsageData = {
		rate_limits: {},
		extra_usage: { used_credits: 850, monthly_limit: 1000, is_enabled: true },
	};
	const q = deriveQuota(base, enabled, null, clock);
	expect(q.payg?.usedCredits).toBe(8.5);
	expect(q.payg?.monthlyLimit).toBe(10);
	// 85% of the limit ⇒ over the near-cap threshold ⇒ critical
	expect(q.payg?.band).toBe("critical");

	// Under the caution threshold (10%) ⇒ unsigned nominal; past it (70%) ⇒ caution.
	const low: UsageData = {
		rate_limits: {},
		extra_usage: { used_credits: 100, monthly_limit: 1000, is_enabled: true },
	};
	expect(deriveQuota(base, low, null, clock).payg?.band).toBe("nominal");
	const mid: UsageData = {
		rate_limits: {},
		extra_usage: { used_credits: 700, monthly_limit: 1000, is_enabled: true },
	};
	expect(deriveQuota(base, mid, null, clock).payg?.band).toBe("caution");

	const disabled: UsageData = {
		rate_limits: {},
		extra_usage: { used_credits: 850, monthly_limit: 1000, is_enabled: false },
	};
	expect(deriveQuota(base, disabled, null, clock).payg).toBeUndefined();
});

test("PAYG with no cap is unsigned (nominal) when monthly_limit is zero/absent", () => {
	const usage: UsageData = {
		rate_limits: {},
		extra_usage: { used_credits: 500, monthly_limit: 0, is_enabled: true },
	};
	const q = deriveQuota(base, usage, null, clock);
	expect(q.payg?.band).toBe("nominal");
	expect(q.payg?.monthlyLimit).toBe(0);
});

test("balance from the snapshot, low band below the floor", () => {
	const snap: BalanceSnapshot = { amount: 12, currency: "USD", ts: NOW };
	const q = deriveQuota(base, null, snap, clock);
	expect(q.balance?.label).toBe("$12.00");
	expect(q.balance?.band).toBe("caution");

	const flush: BalanceSnapshot = { amount: 200, currency: "USD", ts: NOW };
	expect(deriveQuota(base, null, flush, clock).balance?.band).toBe("nominal");
});

test("no sources ⇒ empty quota info", () => {
	expect(deriveQuota(base, null, null, clock)).toEqual({});
});
