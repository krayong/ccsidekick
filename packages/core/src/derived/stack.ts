import { STACKS, type Event, type Stack } from "../domain";
import type { MarkerSet } from "../sources";

/** Union of the cwd-marker stacks and the stack tags carried by classified events. */
export function deriveStacks(markers: MarkerSet, events: readonly Event[]): Set<Stack> {
	const out = new Set<Stack>(markers.stacks);
	for (const e of events) {
		if (e.stack !== undefined) out.add(e.stack);
	}
	return out;
}

/**
 * Pick the single stack to voice. The freshest classified event's stack tag is the most specific signal and
 * wins when present; otherwise pick by authoring priority — the first stack in `STACKS` (the prevalence
 * ranking) present in the set. Returns `null` when nothing is detected.
 */
export function pickStack(stacks: ReadonlySet<Stack>, freshEventStack?: Stack): Stack | null {
	if (freshEventStack !== undefined) return freshEventStack;
	for (const s of STACKS) {
		if (stacks.has(s)) return s;
	}
	return null;
}
