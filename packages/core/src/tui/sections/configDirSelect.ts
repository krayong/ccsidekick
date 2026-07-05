// Pure state helpers for the multi-select config-dir picker. The picker holds a Set of checked row indices over
// the combined [discovered..., custom-added...] target list; these functions compute the next Set without any
// React or fs. Kept apart from the .tsx so they unit-test without pulling in Ink.

import type { SaveTarget } from "../shell";

/** Toggle a single index in the checked set, returning a new Set. */
export function toggleOne(checked: ReadonlySet<number>, i: number): Set<number> {
	const next = new Set(checked);
	if (next.has(i)) next.delete(i);
	else next.add(i);
	return next;
}

/** Select-all / select-none: clear when every index is already checked, otherwise check `0..total-1`. */
export function toggleAll(checked: ReadonlySet<number>, total: number): Set<number> {
	if (checked.size >= total) return new Set();
	return new Set(Array.from({ length: total }, (_, i) => i));
}

/** True iff at least one dir is checked (the confirm guard). */
export function canConfirm(checked: ReadonlySet<number>): boolean {
	return checked.size > 0;
}

/** The targets at the checked indices, in list order. */
export function checkedTargets(
	targets: readonly SaveTarget[],
	checked: ReadonlySet<number>,
): SaveTarget[] {
	return targets.filter((_, i) => checked.has(i));
}
