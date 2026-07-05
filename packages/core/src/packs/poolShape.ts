// The single source of the 620-line voice library's shape: every counted leaf-cell path and its expected line
// count. Keyed by the same dotted paths `lint.ts:leafCells` produces (e.g. "mood.idle.stranger", "dateEgg").
// The count gate, `lint --status`, and the template coverage tally all read this and only this, so per-cell
// counts never drift across encodings. spinnerVerbs is not a counted cell (it has a floor, not an exact count).

import { MOODS, PRESSURE_MOODS, REACTION_CATEGORIES, STACKS, TIERS } from "../domain";

const GREETING_BUCKETS = ["morning", "day", "evening", "night", "weekend"] as const;
const MILESTONES = ["tier_up", "comeback", "streak", "anniversary"] as const;
const POSITIVE_GIT = ["clean_tree", "op_cleared", "branch_created", "tag_pushed"] as const;
const STACK_MOMENTS = ["slow", "fail"] as const;

// Per-cell counts. mood is the only pool whose count varies by its outer key (idle 10, the rest 5).
const PER_CELL: Readonly<Record<string, number>> = {
	greeting: 3,
	firstContact: 3,
	milestone: 3,
	positiveGit: 3,
	egg: 5,
	event: 3,
	stack: 3,
	pressure: 3,
	dateEgg: 10,
};
const MOOD_PER_CELL: Readonly<Record<string, number>> = {
	idle: 10,
	busy: 5,
	happy: 5,
	struggling: 5,
	recovery: 5,
};

export function expectedCount(path: string): number {
	const parts = path.split(".");
	const head = parts[0] ?? "";
	if (head === "mood") return MOOD_PER_CELL[parts[1] ?? ""] ?? 0;
	return PER_CELL[head] ?? 0;
}

function build(): string[] {
	const paths: string[] = [];
	const r2 = (pool: string, outer: readonly string[], inner: readonly string[]): void => {
		for (const o of outer) for (const i of inner) paths.push(`${pool}.${o}.${i}`);
	};
	const r1 = (pool: string, keys: readonly string[]): void => {
		for (const k of keys) paths.push(`${pool}.${k}`);
	};
	r2("mood", MOODS, TIERS);
	r2("greeting", GREETING_BUCKETS, TIERS);
	r1("firstContact", TIERS);
	r2("milestone", MILESTONES, TIERS);
	r2("positiveGit", POSITIVE_GIT, TIERS);
	r1("egg", TIERS);
	r1("event", REACTION_CATEGORIES);
	r2("stack", STACKS, STACK_MOMENTS);
	r1("pressure", PRESSURE_MOODS);
	paths.push("dateEgg");
	return paths;
}

export const LEAF_PATHS: readonly string[] = build();
