import { expect, test } from "bun:test";

import { HELPFUL_COOLDOWN_MS, HELPFUL_SHOW_MS, HOT_MS, type Event } from "../../domain";
import type { Clock, GitState, SessionState, TranscriptScan } from "../../sources";

import type { HelpfulInputs } from "./catalog";
import { resolveHelpful } from "./resolve";

const T0 = 1_000_000;
const clockAt = (ms: number): Clock => ({ now: () => ms, timezone: () => "UTC" });

const git: GitState = {
	branch: "main",
	staged: 0,
	unstaged: 0,
	untracked: [],
	conflict: 0,
	operation: "none",
	stash: 0,
	submoduleBranches: [],
	insertions: 0,
	deletions: 0,
	changedFiles: 0,
	upstream: true,
	upstreamGone: false,
};

const scan: TranscriptScan = {
	tokens: { input: 0, output: 0, cache_read: 0, cache_creation_5m: 0, cache_creation_1h: 0 },
	messages: 0,
	compactions: 0,
	todos: [],
	burn: [],
	mtime: 0,
	size: 0,
};

function mk(over: Partial<HelpfulInputs> & { nowMs: number }): HelpfulInputs {
	return {
		payload: { workspace: {}, model: {} },
		git,
		events: [],
		scan,
		helpfulEnv: {},
		quota: {},
		context: {
			usedPct: 0,
			usedTokens: 0,
			windowSize: 0,
			band: "nominal",
			compactions: 0,
			cacheHitPct: 0,
			compactPressure: false,
		},
		env: {
			hasApiKey: false,
			hasAuthToken: false,
			customBaseUrl: false,
			useBedrock: false,
			useVertex: false,
			useFoundry: false,
			useMantle: false,
			useAnthropicAws: false,
			managedByHost: false,
			hasOauthToken: false,
		},
		creds: null,
		balance: null,
		...over,
	};
}

const EMPTY: SessionState = { pressureFired: [], milestones: [], helpful: {} };
const stateOf = (helpful: SessionState["helpful"]): SessionState => ({ ...EMPTY, helpful });

// condition activators
const conflict = (n: number): Partial<HelpfulInputs> => ({ git: { ...git, conflict: n } });
const compactSoon: Partial<HelpfulInputs> = {
	context: {
		usedPct: 70,
		usedTokens: 0,
		windowSize: 0,
		band: "nominal",
		compactions: 0,
		cacheHitPct: 0,
		compactPressure: false,
	},
};
const effortLow: Partial<HelpfulInputs> = {
	payload: { workspace: {}, model: {}, effort: { level: "low" } },
};

const i = (ms: number) => mk({ nowMs: ms, ...compactSoon });
const both = (ms: number) => mk({ nowMs: ms, ...conflict(2), ...compactSoon });

test("higher severity wins among the active set", () => {
	const r = resolveHelpful(
		mk({ nowMs: T0, ...conflict(2), ...compactSoon }),
		EMPTY,
		clockAt(T0),
		"low",
	);
	expect(r.comment?.id).toBe("merge_conflict"); // high beats the medium compact_soon
});

test("a severity tie breaks by category order (quota before git)", () => {
	const r = resolveHelpful(
		mk({ nowMs: T0, quota: { block: { usedPct: 84, band: "critical" } }, ...conflict(2) }),
		EMPTY,
		clockAt(T0),
		"low",
	);
	expect(r.comment?.id).toBe("block_almost_spent"); // both high; quota (2) precedes git (4)
});

test("a diverged repo shows the diverged tip, not the plainer behind_upstream", () => {
	// ahead AND behind fires both triggers (same severity + category); diverged is listed first, so it wins.
	const r = resolveHelpful(
		mk({ nowMs: T0, git: { ...git, ahead: 2, behind: 3 } }),
		EMPTY,
		clockAt(T0),
		"low",
	);
	expect(r.comment?.id).toBe("diverged");
});

test("min_severity floor drops a low comment before selection", () => {
	const lowOnly = mk({ nowMs: T0, ...effortLow });
	expect(resolveHelpful(lowOnly, EMPTY, clockAt(T0), "low").comment?.id).toBe("effort_low");
	expect(resolveHelpful(lowOnly, EMPTY, clockAt(T0), "medium").comment).toBeNull();
});

test("a momentary critical stays shown for HELPFUL_SHOW_MS after its condition clears", () => {
	const fire: Event[] = [{ ts: T0, category: "dangerous" }];
	const r1 = resolveHelpful(mk({ nowMs: T0, events: fire }), EMPTY, clockAt(T0), "low");
	expect(r1.comment?.id).toBe("destructive_command");

	// condition gone (no event), still inside the 60s floor
	const mid = T0 + 20_000;
	const r2 = resolveHelpful(mk({ nowMs: mid }), stateOf(r1.nextHelpful), clockAt(mid), "low");
	expect(r2.comment?.id).toBe("destructive_command");

	// past the floor
	const late = T0 + HELPFUL_SHOW_MS + 1;
	const r3 = resolveHelpful(mk({ nowMs: late }), stateOf(r2.nextHelpful), clockAt(late), "low");
	expect(r3.comment).toBeNull();
});

test("a momentary high holds the floor past HOT_MS, then enters cooldown", () => {
	const fire: Event[] = [{ ts: T0, category: "force_push" }];
	const r1 = resolveHelpful(mk({ nowMs: T0, events: fire }), EMPTY, clockAt(T0), "low");
	expect(r1.comment?.id).toBe("force_push");

	// after HOT_MS but inside the show floor, condition false → still shown
	const afterHot = T0 + HOT_MS + 5_000;
	const r2 = resolveHelpful(
		mk({ nowMs: afterHot }),
		stateOf(r1.nextHelpful),
		clockAt(afterHot),
		"low",
	);
	expect(r2.comment?.id).toBe("force_push");

	// past the floor → dismissed into cooldown, dropped
	const past = T0 + HELPFUL_SHOW_MS + 1;
	const r3 = resolveHelpful(mk({ nowMs: past }), stateOf(r2.nextHelpful), clockAt(past), "low");
	expect(r3.comment).toBeNull();
	expect(r3.nextHelpful["force_push"]?.dismissedUntilTs).toBe(past + HELPFUL_COOLDOWN_MS);
});

test("a transient shows for HELPFUL_SHOW_MS, then cools down and is dropped mid-cooldown", () => {
	const r1 = resolveHelpful(i(T0), EMPTY, clockAt(T0), "low");
	expect(r1.comment?.id).toBe("compact_soon");

	const mid = T0 + 30_000;
	const r2 = resolveHelpful(i(mid), stateOf(r1.nextHelpful), clockAt(mid), "low");
	expect(r2.comment?.id).toBe("compact_soon"); // still in window

	const expire = T0 + HELPFUL_SHOW_MS + 1;
	const r3 = resolveHelpful(i(expire), stateOf(r2.nextHelpful), clockAt(expire), "low");
	expect(r3.comment).toBeNull(); // window over, no other candidate
	expect(r3.nextHelpful["compact_soon"]?.dismissedUntilTs).toBe(expire + HELPFUL_COOLDOWN_MS);

	const cooling = expire + 5_000;
	const r4 = resolveHelpful(i(cooling), stateOf(r3.nextHelpful), clockAt(cooling), "low");
	expect(r4.comment).toBeNull(); // condition still true but mid-cooldown
});

test("a lower transient does not burn its window while a higher one is on top", () => {
	const r1 = resolveHelpful(both(T0), EMPTY, clockAt(T0), "low");
	expect(r1.comment?.id).toBe("merge_conflict");
	expect(r1.nextHelpful["compact_soon"]).toBeUndefined(); // lower one parked, no window started

	// higher one's window expires; the lower transient now reaches the top and starts a fresh window
	const t = T0 + HELPFUL_SHOW_MS + 1;
	const r2 = resolveHelpful(both(t), stateOf(r1.nextHelpful), clockAt(t), "low");
	expect(r2.comment?.id).toBe("compact_soon");
});

test("a transient's entry resets when its condition turns false (fresh episode shows immediately)", () => {
	const r1 = resolveHelpful(mk({ nowMs: T0, ...compactSoon }), EMPTY, clockAt(T0), "low");
	expect(r1.comment?.id).toBe("compact_soon");

	const off = T0 + 30_000;
	const r2 = resolveHelpful(mk({ nowMs: off }), stateOf(r1.nextHelpful), clockAt(off), "low");
	expect(r2.comment).toBeNull();
	expect(r2.nextHelpful["compact_soon"]).toBeUndefined();

	const back = T0 + 35_000;
	const r3 = resolveHelpful(
		mk({ nowMs: back, ...compactSoon }),
		stateOf(r2.nextHelpful),
		clockAt(back),
		"low",
	);
	expect(r3.comment?.id).toBe("compact_soon");
});

test("a latched critical ignores cooldown and shows whenever its condition holds", () => {
	const urgent: Partial<HelpfulInputs> = {
		context: {
			usedPct: 95,
			usedTokens: 0,
			windowSize: 0,
			band: "critical",
			compactions: 0,
			cacheHitPct: 0,
			compactPressure: false,
		},
	};
	const r = resolveHelpful(mk({ nowMs: T0, ...urgent }), EMPTY, clockAt(T0), "low");
	expect(r.comment?.id).toBe("compact_urgent");
	expect(r.comment?.severity).toBe("critical");
});
