import {
	MOOD_FAIL_N,
	MOOD_WINDOW_MS,
	QUOTA_HIGH_PCT,
	type Event,
	type EventCategory,
	type Mood,
	type PressureMood,
	type RenderMood,
} from "../domain";
import type { Clock, Payload } from "../sources";

import type { ContextInfo } from "./context";
import type { QuotaInfo } from "./quota";

const PASS = new Set<EventCategory>(["test_pass", "build_pass", "typecheck_pass"]);
const FAIL = new Set<EventCategory>(["test_fail", "build_fail", "typecheck_fail"]);

/** Freshest pass/fail signal; ties break toward the fail (failures before wins). */
function freshestSignal(signals: readonly Event[]): Event | undefined {
	let best: Event | undefined;
	for (const e of signals) {
		if (
			best === undefined ||
			e.ts > best.ts ||
			(e.ts === best.ts && FAIL.has(e.category) && PASS.has(best.category))
		) {
			best = e;
		}
	}
	return best;
}

/** Base mood from the events still inside `MOOD_WINDOW_MS`, evaluated recovery → struggling → happy → busy. */
function baseMood(events: readonly Event[], clock: Clock): Mood {
	const cutoff = clock.now() - MOOD_WINDOW_MS;
	const live = events.filter((e) => e.ts >= cutoff);
	if (live.length === 0) return "idle";

	const signals = live.filter((e) => PASS.has(e.category) || FAIL.has(e.category));
	const latest = freshestSignal(signals);
	if (latest === undefined) return "busy"; // activity with no governing pass/fail

	const latestIsPass = PASS.has(latest.category);
	if (latestIsPass && signals.some((e) => FAIL.has(e.category) && e.ts < latest.ts)) {
		return "recovery";
	}
	const failCount = signals.filter((e) => FAIL.has(e.category)).length;
	if (failCount >= MOOD_FAIL_N && !latestIsPass) return "struggling";
	if (latestIsPass) return "happy";
	return "busy";
}

/** A synthetic pressure mood when its pinned threshold trips; first match wins (compact → block → weekly). */
function pressureMood(quota: QuotaInfo, context: ContextInfo): PressureMood | undefined {
	if (context.compactPressure) return "compact_hint";
	if ((quota.block?.usedPct ?? 0) > QUOTA_HIGH_PCT) return "block_limit";
	if ((quota.weekly?.usedPct ?? 0) > QUOTA_HIGH_PCT) return "weekly_limit";
	return undefined;
}

/**
 * The mood rendered this tick. A tripped synthetic pressure mood (compaction / 5h / weekly quota) overrides
 * the event-derived base for the figure; otherwise the base mood is returned. Pure: the once-per-session
 * `pressureFired` latch and same-tick coordination mute live in `compose/character`, not here. `HOT_MS` is a
 * classifier constant and is deliberately not used in mood resolution.
 */
export function deriveMood(
	events: readonly Event[],
	_payload: Payload,
	quota: QuotaInfo,
	context: ContextInfo,
	clock: Clock,
): RenderMood {
	return pressureMood(quota, context) ?? baseMood(events, clock);
}
