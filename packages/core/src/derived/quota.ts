import {
	BALANCE_LOW,
	PAY_AS_YOU_GO_CAUTION_PCT,
	PAY_AS_YOU_GO_NEAR_PCT,
	type SignalLevel,
} from "../domain";
import { fmtLeft, symbolFor } from "../format";
import type { BalanceSnapshot, Clock, OAuthQuota, Payload, UsageData } from "../sources";

import { overQuotaPace, quotaBand } from "./signals";

/** One quota window (block or weekly): usage percent, its band, and a reset countdown when known. */
interface QuotaWindow {
	readonly usedPct: number;
	readonly band: SignalLevel;
	/**
	 * Whether usage is running ahead of the clock (will empty the window before it resets). Distinct from
	 * `band`, which forces critical at absolute-high usage regardless of pace; `overPace` stays false for a
	 * high-but-under-pace window. `deriveQuota` always sets it (false when `resets_at` is unknown); it is
	 * optional only so test fixtures that don't exercise pace need not specify it.
	 */
	readonly overPace?: boolean;
	/** Reset countdown string (`fmtLeft`); omitted when `resets_at` is unknown (countdown hidden). */
	readonly resetIn?: string;
}

/** Pay-as-you-go credits in dollars (credits ÷ 100), with a near-cap band. */
interface PaygInfo {
	readonly usedCredits: number;
	readonly monthlyLimit: number;
	readonly band: SignalLevel;
}

/** External prepaid-balance label + band. */
interface BalanceInfo {
	readonly label: string;
	readonly band: SignalLevel;
	/** The USD amount, set only when the balance is in USD, so compose can append a local-currency conversion. */
	readonly usd?: number;
}

export interface QuotaInfo {
	readonly block?: QuotaWindow;
	readonly weekly?: QuotaWindow;
	readonly payg?: PaygInfo;
	readonly balance?: BalanceInfo;
}

type PayloadQuota = NonNullable<Payload["rate_limits"]>["five_hour"];

/** Window spans for the pace-vs-runway band: 5h for the block window, 7d for the weekly. */
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build one window, preferring the payload source over the OAuth source. The two carry different unit forms:
 * the payload's `used_percentage` (0–100) with an epoch-**seconds** `resets_at` (×1000), and the OAuth
 * `utilization` (0–100) with a `resets_at` already in epoch **ms** (the source NaN-guards the ISO parse). The
 * band is the pace-vs-runway band (`quotaBand`), which reads `resets_at` against `windowMs`; a reset, when
 * known, also adds the countdown.
 */
function buildWindow(
	payloadQuota: PayloadQuota,
	oauthQuota: OAuthQuota | undefined,
	windowMs: number,
	clock: Clock,
): QuotaWindow | undefined {
	let usedPct: number;
	let resetsAtMs: number | undefined;
	if (payloadQuota !== undefined) {
		usedPct = payloadQuota.used_percentage ?? 0;
		resetsAtMs =
			payloadQuota.resets_at !== undefined ? payloadQuota.resets_at * 1000 : undefined;
	} else if (oauthQuota !== undefined) {
		usedPct = oauthQuota.utilization;
		resetsAtMs = oauthQuota.resets_at;
	} else {
		return undefined;
	}

	const band = quotaBand(usedPct, resetsAtMs, windowMs, clock.now());
	const overPace = overQuotaPace(usedPct, resetsAtMs, windowMs, clock.now());
	if (resetsAtMs === undefined) return { usedPct, band, overPace };

	const left = resetsAtMs - clock.now();
	if (left <= 0) return { usedPct, band, overPace };

	return { usedPct, band, overPace, resetIn: fmtLeft(left) };
}

/** PAYG from the OAuth `extra_usage`, gated on `is_enabled`; unsigned under the caution threshold, then caution/critical. */
function buildPayg(usage: UsageData | null): PaygInfo | undefined {
	const extra = usage?.extra_usage;
	if (extra === undefined || extra.is_enabled !== true) return undefined;
	const credits = extra.used_credits ?? 0;
	const limit = extra.monthly_limit;
	// Below the caution threshold the field stays unsigned (nominal, no tint); past it the field reads caution
	// and the near-cap threshold escalates it to critical. With no cap there is no fullness to band on.
	let band: SignalLevel = "nominal";
	if (limit !== undefined && limit > 0) {
		const ratioPct = (100 * credits) / limit;
		band =
			ratioPct > PAY_AS_YOU_GO_NEAR_PCT ? "critical"
			: ratioPct > PAY_AS_YOU_GO_CAUTION_PCT ? "caution"
			: "nominal";
	}
	return { usedCredits: credits / 100, monthlyLimit: (limit ?? 0) / 100, band };
}

function buildBalance(balance: BalanceSnapshot | null): BalanceInfo | undefined {
	if (balance === null) return undefined;
	// Symbol-prefixed amount (`$8.40`); an unknown currency falls back to a `CODE ` prefix via symbolFor.
	return {
		label: `${symbolFor(balance.currency)}${balance.amount.toFixed(2)}`,
		band: balance.amount < BALANCE_LOW ? "caution" : "nominal",
		...(balance.currency === "USD" ? { usd: balance.amount } : {}),
	};
}

/**
 * Quota info from the payload `rate_limits` (preferred) or the OAuth `usage` fallback, plus PAYG and the
 * external balance snapshot. Pure: no I/O, no wall-clock except the injected `clock`.
 */
export function deriveQuota(
	payload: Payload,
	usage: UsageData | null,
	balance: BalanceSnapshot | null,
	clock: Clock,
): QuotaInfo {
	const block = buildWindow(
		payload.rate_limits?.five_hour,
		usage?.rate_limits.five_hour,
		FIVE_HOUR_MS,
		clock,
	);
	const weekly = buildWindow(
		payload.rate_limits?.seven_day,
		usage?.rate_limits.seven_day,
		SEVEN_DAY_MS,
		clock,
	);
	const payg = buildPayg(usage);
	const bal = buildBalance(balance);

	return {
		...(block !== undefined ? { block } : {}),
		...(weekly !== undefined ? { weekly } : {}),
		...(payg !== undefined ? { payg } : {}),
		...(bal !== undefined ? { balance: bal } : {}),
	};
}
