import { expect, test } from "bun:test";

import { HELPFUL_MAX_LEN, type Event } from "../../domain";
import type { GitState, TranscriptScan } from "../../sources";

import { HELPFUL_CATALOG, type HelpfulInputs } from "./catalog";

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
	remoteBranchExists: false,
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

const BASE: HelpfulInputs = {
	nowMs: 1_000_000,
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
};

const find = (id: string) => {
	const t = HELPFUL_CATALOG.find((x) => x.id === id);
	if (t === undefined) throw new Error(`no trigger ${id}`);
	return t;
};

test("there are exactly 41 triggers and every template is within HELPFUL_MAX_LEN", () => {
	expect(HELPFUL_CATALOG.length).toBe(41);
	for (const t of HELPFUL_CATALOG) {
		expect(t.template.length).toBeLessThanOrEqual(HELPFUL_MAX_LEN);
	}
});

test("trigger ids are unique", () => {
	const ids = new Set(HELPFUL_CATALOG.map((t) => t.id));
	expect(ids.size).toBe(41);
});

test("only untracked_secret/destructive_command/api_key_while_subscribed/commit_on_detached/compact_urgent are critical", () => {
	const criticals = HELPFUL_CATALOG.filter((t) => t.severity === "critical").map((t) => t.id);
	expect(new Set(criticals)).toEqual(
		new Set([
			"untracked_secret",
			"destructive_command",
			"api_key_while_subscribed",
			"commit_on_detached",
			"compact_urgent",
		]),
	);
});

test("exactly five momentary triggers", () => {
	const momentary = HELPFUL_CATALOG.filter((t) => t.momentary).map((t) => t.id);
	expect(new Set(momentary)).toEqual(
		new Set([
			"destructive_command",
			"commit_on_detached",
			"force_push",
			"pushed_to_default",
			"commit_on_default",
		]),
	);
});

test("long_session was removed", () => {
	expect(HELPFUL_CATALOG.find((t) => t.id === "long_session")).toBeUndefined();
});

test("pay_as_you_go_active fires only with a plan window (not on a usage-based-only plan)", () => {
	const t = find("pay_as_you_go_active");
	const payg = { usedCredits: 5, monthlyLimit: 0, band: "nominal" as const };
	const window = { usedPct: 10, band: "nominal" as const };
	// subscription + pay-as-you-go: a plan window exists ⇒ "bills on top of your plan" applies
	expect(t.test({ ...BASE, quota: { payg, block: window } })).toBe(true);
	// pay-as-you-go only (no plan window): nothing to bill "on top of" ⇒ suppressed
	expect(t.test({ ...BASE, quota: { payg } })).toBe(false);
	// no pay-as-you-go usage ⇒ suppressed
	expect(t.test({ ...BASE, quota: { block: window } })).toBe(false);
});

test("untracked_secret fires on a secret basename minus SECRET_SAFE", () => {
	const t = find("untracked_secret");
	expect(t.test({ ...BASE, git: { ...git, untracked: ["config/.env"] } })).toBe(true);
	expect(t.test({ ...BASE, git: { ...git, untracked: [".env.example"] } })).toBe(false);
	expect(t.test({ ...BASE, git: { ...git, untracked: ["id_rsa"] } })).toBe(true);
	expect(t.test({ ...BASE, git: { ...git, untracked: ["main.ts"] } })).toBe(false);
	expect(t.render({ ...BASE, git: { ...git, untracked: ["config/.env"] } })).toContain("`.env`");
});

test("destructive_command fires only within HOT_MS", () => {
	const t = find("destructive_command");
	const fresh: Event[] = [{ ts: BASE.nowMs - 5_000, category: "dangerous" }];
	const stale: Event[] = [{ ts: BASE.nowMs - 60_000, category: "dangerous" }];
	expect(t.test({ ...BASE, events: fresh })).toBe(true);
	expect(t.test({ ...BASE, events: stale })).toBe(false);
});

test("pushed_to_default needs a hot push on the default branch", () => {
	const t = find("pushed_to_default");
	const onDefault: GitState = { ...git, branch: "main", defaultBranch: "main" };
	const onFeature: GitState = { ...git, branch: "feat", defaultBranch: "main" };
	const push: Event[] = [{ ts: BASE.nowMs - 1_000, category: "git_push" }];
	expect(t.test({ ...BASE, git: onDefault, events: push })).toBe(true);
	expect(t.test({ ...BASE, git: onFeature, events: push })).toBe(false);
	expect(t.test({ ...BASE, git: onDefault, events: [] })).toBe(false);
});

test("commit_on_default fires (medium) only on a hot commit on the default branch", () => {
	const t = find("commit_on_default");
	expect(t.severity).toBe("medium");
	const onDefaultDirty: GitState = {
		...git,
		branch: "main",
		defaultBranch: "main",
		staged: 2,
	};
	const onFeature: GitState = { ...git, branch: "feat", defaultBranch: "main", staged: 2 };
	const commit: Event[] = [{ ts: BASE.nowMs - 1_000, category: "git_commit" }];
	expect(t.test({ ...BASE, git: onDefaultDirty, events: commit })).toBe(true);
	// dirty on default without a commit event must NOT raise the committing nudge.
	expect(t.test({ ...BASE, git: onDefaultDirty, events: [] })).toBe(false);
	expect(t.test({ ...BASE, git: onFeature, events: commit })).toBe(false);
	expect(t.render({ ...BASE, git: onDefaultDirty, events: commit })).toBe(
		"Committing on `main` directly. Branch off with `git switch -c`.",
	);
});

test("dirty_default_branch nudges (low) on uncommitted changes on the default branch", () => {
	const t = find("dirty_default_branch");
	expect(t.severity).toBe("low");
	const onDefaultDirty: GitState = { ...git, branch: "main", defaultBranch: "main", unstaged: 1 };
	const onDefaultClean: GitState = { ...git, branch: "main", defaultBranch: "main" };
	const onFeature: GitState = { ...git, branch: "feat", defaultBranch: "main", unstaged: 1 };
	expect(t.test({ ...BASE, git: onDefaultDirty })).toBe(true);
	expect(t.test({ ...BASE, git: onDefaultClean })).toBe(false);
	expect(t.test({ ...BASE, git: onFeature })).toBe(false);
	expect(t.render({ ...BASE, git: onDefaultDirty })).toBe(
		"Working on `main` directly. Branch off with `git switch -c`.",
	);
});

test("big_diff fires on a large net line imbalance and renders the counts", () => {
	const t = find("big_diff");
	// Net imbalance over the threshold fires; a balanced churn of the same size does not.
	expect(t.test({ ...BASE, git: { ...git, insertions: 1200, deletions: 100 } })).toBe(true);
	expect(t.test({ ...BASE, git: { ...git, insertions: 700, deletions: 700 } })).toBe(false);
	expect(t.test({ ...BASE, git: { ...git, insertions: 400, deletions: 200 } })).toBe(false);
	expect(t.test({ ...BASE, git: null })).toBe(false);
	expect(t.render({ ...BASE, git: { ...git, insertions: 1200, deletions: 100 } })).toBe(
		"Large diff: +1200/-100. Review in chunks.",
	);
});

test("stale_branch fires on behindDefault over the threshold", () => {
	const t = find("stale_branch");
	expect(t.test({ ...BASE, git: { ...git, behindDefault: 25, defaultBranch: "main" } })).toBe(
		true,
	);
	expect(t.test({ ...BASE, git: { ...git, behindDefault: 5, defaultBranch: "main" } })).toBe(
		false,
	);
	expect(t.test({ ...BASE, git: { ...git, defaultBranch: "main" } })).toBe(false);
	expect(t.render({ ...BASE, git: { ...git, behindDefault: 25, defaultBranch: "main" } })).toBe(
		"25 behind `main`. Sync before the rebase gets ugly.",
	);
});

test("submodule_uninitialized fires on an uninitialized submodule", () => {
	const t = find("submodule_uninitialized");
	expect(t.test({ ...BASE, git: { ...git, uninitializedSubmodule: "vendor/lib" } })).toBe(true);
	expect(t.test({ ...BASE, git: { ...git } })).toBe(false);
	expect(t.render({ ...BASE, git: { ...git, uninitializedSubmodule: "vendor/lib" } })).toBe(
		"Submodule `vendor/lib` is empty. `git submodule update --init`.",
	);
});

test("quota and context triggers read the derived structs", () => {
	expect(
		find("block_almost_spent").test({
			...BASE,
			quota: { block: { usedPct: 84, band: "critical" } },
		}),
	).toBe(true);
	expect(
		find("compact_urgent").test({ ...BASE, context: { ...BASE.context, usedPct: 92 } }),
	).toBe(true);
	expect(find("compact_soon").test({ ...BASE, context: { ...BASE.context, usedPct: 70 } })).toBe(
		true,
	);
	expect(
		find("compact_urgent").test({ ...BASE, context: { ...BASE.context, usedPct: 70 } }),
	).toBe(false);
});

test("weekly_will_exhaust needs both an off-pace band and usage past the projection floor", () => {
	const t = find("weekly_will_exhaust");
	// Early-window pace spike at trivial usage must stay silent (the misfire the gate fixes).
	expect(t.test({ ...BASE, quota: { weekly: { usedPct: 10, band: "critical" } } })).toBe(false);
	// Past the halfway floor and off pace ⇒ the projection is credible.
	expect(t.test({ ...BASE, quota: { weekly: { usedPct: 60, band: "caution" } } })).toBe(true);
	// Past the floor but on pace ⇒ silent.
	expect(t.test({ ...BASE, quota: { weekly: { usedPct: 60, band: "nominal" } } })).toBe(false);
});

test("block_will_exhaust needs both an off-pace band and usage past the projection floor", () => {
	const t = find("block_will_exhaust");
	expect(t.test({ ...BASE, quota: { block: { usedPct: 10, band: "critical" } } })).toBe(false);
	expect(t.test({ ...BASE, quota: { block: { usedPct: 60, band: "caution" } } })).toBe(true);
	expect(t.test({ ...BASE, quota: { block: { usedPct: 60, band: "nominal" } } })).toBe(false);
});

test("git hygiene triggers read GitState", () => {
	const detachedGit: GitState = {
		sha: "abc1234",
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
		upstream: false,
		upstreamGone: false,
		remoteBranchExists: false,
	};
	expect(find("merge_conflict").test({ ...BASE, git: { ...git, conflict: 3 } })).toBe(true);
	expect(find("diverged").test({ ...BASE, git: { ...git, ahead: 2, behind: 1 } })).toBe(true);
	expect(find("detached_head").test({ ...BASE, git: detachedGit })).toBe(true);
	expect(find("rebase_in_progress").test({ ...BASE, git: { ...git, operation: "rebase" } })).toBe(
		true,
	);
});

test("no_upstream fires without an upstream, but not once the branch is on the remote", () => {
	const noUp = { ...git, upstream: false, remoteBranchExists: false };
	expect(find("no_upstream").test({ ...BASE, git: noUp })).toBe(true);
	// Pushed without `-u`: a remote-tracking ref exists, so the hint is noise and stays quiet.
	expect(find("no_upstream").test({ ...BASE, git: { ...noUp, remoteBranchExists: true } })).toBe(
		false,
	);
});

test("rendered lines interpolate live values", () => {
	const t = find("block_almost_spent");
	const line = t.render({
		...BASE,
		quota: { block: { usedPct: 84, band: "critical", resetIn: "4hr 20min left" } },
	});
	expect(line).toBe("5h limit at 84%, 4hr 20min to reset. Save heavy asks for after.");
});
