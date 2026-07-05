import {
	HELPFUL_COOLDOWN_MS,
	HELPFUL_SHOW_MS,
	type HelpfulComment,
	type Severity,
} from "../../domain";
import type { Clock, SessionState } from "../../sources";

import {
	HELPFUL_CATALOG,
	type HelpfulCategory,
	type HelpfulInputs,
	type HelpfulTrigger,
} from "./catalog";

interface Entry {
	shownSinceTs: number;
	dismissedUntilTs: number;
}
type HelpfulMap = Record<string, Entry>;

const SEV_RANK: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const CAT_ORDER: Record<HelpfulCategory, number> = {
	safety: 0,
	billing: 1,
	quota: 2,
	context: 3,
	git: 4,
	workflow: 5,
};
const INDEX = new Map(HELPFUL_CATALOG.map((t, i) => [t.id, i]));

/** A high/medium/low trigger with a latched (non-momentary) condition: the transient show/cooldown class. */
const isTransient = (t: HelpfulTrigger): boolean => !t.momentary && t.severity !== "critical";

/** Highest severity first; ties by category order, then catalog order. */
function byPriority(a: HelpfulTrigger, b: HelpfulTrigger): number {
	const sev = SEV_RANK[b.severity] - SEV_RANK[a.severity];
	if (sev !== 0) return sev;
	const cat = CAT_ORDER[a.category] - CAT_ORDER[b.category];
	if (cat !== 0) return cat;
	return (INDEX.get(a.id) ?? 0) - (INDEX.get(b.id) ?? 0);
}

interface ResolveResult {
	readonly comment: HelpfulComment | null;
	readonly nextHelpful: SessionState["helpful"];
}

type EntryMap = Map<string, Entry>;

/**
 * One momentary trigger's state transition for this tick: latch `shownSinceTs` on the first event and hold the
 * min-show floor; on expiry a momentary high cools down while others clear. Mutates `next`, returns its eligibility.
 */
function stepMomentary(
	t: HelpfulTrigger,
	next: EntryMap,
	cond: Map<string, boolean>,
	now: number,
): boolean {
	const e = next.get(t.id);
	const shown = e?.shownSinceTs ?? 0;
	const dismissed = e?.dismissedUntilTs ?? 0;
	if (dismissed > now) return false;
	if (cond.get(t.id) === true) {
		next.set(t.id, { shownSinceTs: shown === 0 ? now : shown, dismissedUntilTs: 0 });
		return true;
	}
	if (shown !== 0 && now - shown < HELPFUL_SHOW_MS) {
		next.set(t.id, { shownSinceTs: shown, dismissedUntilTs: 0 });
		return true;
	}
	if (shown !== 0 && t.severity === "high") {
		next.set(t.id, { shownSinceTs: 0, dismissedUntilTs: now + HELPFUL_COOLDOWN_MS });
	} else {
		next.delete(t.id);
	}
	return false;
}

/** Momentary pass over the catalog; mutates `next`, returns per-id eligibility for the candidate filter. */
function applyMomentaryPass(
	next: EntryMap,
	cond: Map<string, boolean>,
	now: number,
): Map<string, boolean> {
	const eligible = new Map<string, boolean>();
	for (const t of HELPFUL_CATALOG) {
		if (t.momentary) eligible.set(t.id, stepMomentary(t, next, cond, now));
	}
	return eligible;
}

/** The active set above the severity floor: critical by condition, momentary by eligibility, transient by cond+cooldown; sorted by priority. */
function collectCandidates(
	next: EntryMap,
	cond: Map<string, boolean>,
	momentaryEligible: Map<string, boolean>,
	minRank: number,
	now: number,
): HelpfulTrigger[] {
	return HELPFUL_CATALOG.filter((t) => SEV_RANK[t.severity] >= minRank)
		.filter((t) => {
			if (t.severity === "critical" && !t.momentary) return cond.get(t.id) === true;
			if (t.momentary) return momentaryEligible.get(t.id) === true;
			const dismissed = next.get(t.id)?.dismissedUntilTs ?? 0;
			return cond.get(t.id) === true && dismissed <= now;
		})
		.sort(byPriority);
}

/** Pick the top candidate; a transient whose show window has expired dismisses and steps aside for the next. */
function selectTop(
	candidates: readonly HelpfulTrigger[],
	next: EntryMap,
	now: number,
): HelpfulTrigger | undefined {
	for (const top of candidates) {
		if (isTransient(top)) {
			const shown = next.get(top.id)?.shownSinceTs ?? 0;
			if (shown !== 0 && now - shown >= HELPFUL_SHOW_MS) {
				next.set(top.id, { shownSinceTs: 0, dismissedUntilTs: now + HELPFUL_COOLDOWN_MS });
				continue;
			}
		}
		return top;
	}
	return undefined;
}

/** Non-selected transients keep a live cooldown but shed any live show window (don't burn it under a higher one). */
function shedNonSelectedWindows(
	next: EntryMap,
	selected: HelpfulTrigger | undefined,
	now: number,
): void {
	for (const t of HELPFUL_CATALOG) {
		if (!isTransient(t) || (selected !== undefined && t.id === selected.id)) continue;
		const e = next.get(t.id);
		if (e === undefined) continue;
		if (e.dismissedUntilTs > now)
			next.set(t.id, { shownSinceTs: 0, dismissedUntilTs: e.dismissedUntilTs });
		else next.delete(t.id);
	}
}

/**
 * Resolve the single highest-severity active helpful comment and the next dismissal map. Pure: time comes from
 * `clock`, the rest from `inputs`/`state`. Honors `minSeverity` (the floor applies before selection). Caller
 * gates `[helpful].enabled` (returns nothing) before invoking. Lifetime:
 *  - latched `critical`: active whenever its condition holds; no cooldown, no map entry.
 *  - momentary triggers: latch `shownSinceTs` on the first event and stay active a minimum `HELPFUL_SHOW_MS`;
 *    momentary highs then enter `HELPFUL_COOLDOWN_MS` on dismissal, momentary criticals never cool down.
 *  - transient (`high`/`medium`/`low`, latched): the show window starts the tick it reaches the top of the
 *    active set, runs `HELPFUL_SHOW_MS`, then dismisses into `HELPFUL_COOLDOWN_MS`. A condition-false entry is
 *    reset so a fresh episode shows immediately, and a non-top transient never burns its window.
 */
export function resolveHelpful(
	inputs: HelpfulInputs,
	state: SessionState,
	clock: Clock,
	minSeverity: Severity,
): ResolveResult {
	const now = clock.now();
	const minRank = SEV_RANK[minSeverity];
	const next = new Map<string, Entry>();
	for (const [id, e] of Object.entries(state.helpful)) next.set(id, { ...e });

	const cond = new Map<string, boolean>();
	for (const t of HELPFUL_CATALOG) cond.set(t.id, t.test(inputs));

	const momentaryEligible = applyMomentaryPass(next, cond, now);

	// Reset a transient whose condition turned false, so its next episode shows immediately.
	for (const t of HELPFUL_CATALOG) {
		if (isTransient(t) && cond.get(t.id) !== true) next.delete(t.id);
	}

	const candidates = collectCandidates(next, cond, momentaryEligible, minRank, now);
	const selected = selectTop(candidates, next, now);

	if (selected !== undefined && isTransient(selected)) {
		const prev = next.get(selected.id)?.shownSinceTs ?? 0;
		next.set(selected.id, { shownSinceTs: prev === 0 ? now : prev, dismissedUntilTs: 0 });
	}

	shedNonSelectedWindows(next, selected, now);

	const nextHelpful: HelpfulMap = Object.fromEntries(next);
	if (selected === undefined) return { comment: null, nextHelpful };

	const comment: HelpfulComment = {
		id: selected.id,
		severity: selected.severity,
		text: selected.render(inputs),
	};
	return { comment, nextHelpful };
}
