import type { ContextInfo, QuotaInfo } from "../../derived";
import {
	BALANCE_LOW,
	COMPACT_URGENT_PCT,
	HOT_MS,
	PAY_AS_YOU_GO_NEAR_PCT,
	QUOTA_HIGH_PCT,
	type Event,
	type Severity,
} from "../../domain";
import { fmtGap, pct } from "../../format";
import type {
	BalanceSnapshot,
	CredsInfo,
	EnvInputs,
	GitState,
	HelpfulEnv,
	Payload,
	TranscriptScan,
} from "../../sources";

export { BALANCE_LOW, COMPACT_URGENT_PCT, HOT_MS, PAY_AS_YOU_GO_NEAR_PCT, QUOTA_HIGH_PCT };

/** Thresholds owned by the helpful module. Self-calibrating triggers carry no constant. */
const COMPACT_SOON_PCT = 60;
/** Absolute usage floor for the pace-projection "will exhaust" triggers: below it the pace ratio is noise. */
const QUOTA_PROJECT_MIN_PCT = 50;
const COMPACTION_THRASH_N = 3;
const CACHE_RATIO_FLOOR = 0.5;
const CACHE_WARMUP_TURNS = 20;
const BIG_DIFF_LINES = 1000;
const UNTRACKED_N = 20;
const STASH_N = 5;
const STALE_BRANCH_N = 20;
const TODO_STALLED_MIN = 30;
const EFFORT_LOW_LEVEL = "low";
const PROD_CONTEXT_PATTERN = /prod/i;

/** Untracked basenames that likely hold a real secret (matched case-insensitively against the basename). */
const SECRET_PATTERNS: readonly string[] = [
	".env",
	".env.*",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"*.keystore",
	"*.jks",
	"*.p8",
	"*.ppk",
	"*.asc",
	"id_rsa",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
	".git-credentials",
	".netrc",
	".pypirc",
	".htpasswd",
	"service-account*.json",
];

/** Committed-by-design samples that must never raise a secret critical. */
export const SECRET_SAFE: readonly string[] = [
	"*.example",
	"*.sample",
	"*.template",
	"*.dist",
	"*.tpl",
	"*example*",
	"*sample*",
	"*template*",
];

/** Comment categories, in tie-break order within a severity. */
export type HelpfulCategory = "safety" | "billing" | "quota" | "context" | "git" | "workflow";

/** Live state a trigger reads. `nowMs` is the render tick (event hot-window + age math). */
export interface HelpfulInputs {
	readonly nowMs: number;
	readonly payload: Payload;
	readonly git: GitState | null;
	readonly events: readonly Event[];
	readonly scan: TranscriptScan;
	readonly helpfulEnv: HelpfulEnv;
	readonly quota: QuotaInfo;
	readonly context: ContextInfo;
	readonly env: EnvInputs;
	readonly creds: CredsInfo | null;
	readonly balance: BalanceSnapshot | null;
}

export interface HelpfulTrigger {
	readonly id: string;
	readonly severity: Exclude<Severity, "none">;
	readonly category: HelpfulCategory;
	readonly momentary: boolean;
	/** The raw line with `{…}` placeholders, length-capped at `HELPFUL_MAX_LEN`. */
	readonly template: string;
	readonly test: (i: HelpfulInputs) => boolean;
	readonly render: (i: HelpfulInputs) => string;
}

// ── small helpers ─────────────────────────────────────────────────────────────

/** Compile one glob (only `*`) to an anchored, case-insensitive regex. */
function globToRe(glob: string): RegExp {
	const body = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${body}$`, "i");
}

const SECRET_RE = SECRET_PATTERNS.map(globToRe);
const SAFE_RE = SECRET_SAFE.map(globToRe);

function basename(p: string): string {
	const parts = p.split("/");
	return parts[parts.length - 1] ?? p;
}

function isSecretName(name: string): boolean {
	return SECRET_RE.some((re) => re.test(name)) && !SAFE_RE.some((re) => re.test(name));
}

function secretPath(i: HelpfulInputs): string | undefined {
	return i.git?.untracked.find((p) => isSecretName(basename(p)));
}

/** A classified event of `category` fired within `HOT_MS` of now. */
function hot(i: HelpfulInputs, category: Event["category"]): boolean {
	return i.events.some(
		(e) => e.category === category && i.nowMs - e.ts >= 0 && i.nowMs - e.ts <= HOT_MS,
	);
}

const detached = (g: GitState | null): boolean => g !== null && g.branch === undefined;
const dirty = (g: GitState | null): boolean => g !== null && g.staged + g.unstaged > 0;
const onDefault = (g: GitState | null): boolean =>
	g !== null &&
	g.branch !== undefined &&
	g.defaultBranch !== undefined &&
	g.branch === g.defaultBranch;

const ahead = (g: GitState | null): number => g?.ahead ?? 0;
const behind = (g: GitState | null): number => g?.behind ?? 0;

/** Drop a trailing " left" so a `{reset}` magnitude reads bare (the comment supplies the framing). */
const bare = (left: string | undefined): string => (left ?? "").replace(/ left$/, "");

function cut(s: string, max = 24): string {
	return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

const branchName = (g: GitState | null): string => cut(g?.branch ?? "");

// ── catalog ───────────────────────────────────────────────────────────────────

/** Every helpful trigger, core-owned. Packs never author these. Grouped by category in tie-break order. */
export const HELPFUL_CATALOG: readonly HelpfulTrigger[] = [
	// ── Safety & data loss ──
	{
		id: "untracked_secret",
		severity: "critical",
		category: "safety",
		momentary: false,
		template: "`{name}` isn't ignored. Add it to `.gitignore` before it's committed for good.",
		test: (i) => secretPath(i) !== undefined,
		render: (i) =>
			`\`${cut(basename(secretPath(i) ?? ""))}\` isn't ignored. Add it to \`.gitignore\` before it's committed for good.`,
	},
	{
		id: "destructive_command",
		severity: "critical",
		category: "safety",
		momentary: true,
		template: "Just ran a destructive command, no undo. Check it hit the right target.",
		test: (i) => hot(i, "dangerous"),
		render: () => "Just ran a destructive command, no undo. Check it hit the right target.",
	},
	{
		id: "kube_context_prod",
		severity: "high",
		category: "safety",
		momentary: false,
		template: "kubectl is pointed at a prod cluster. Double-check before any apply or delete.",
		test: (i) =>
			i.helpfulEnv.kubeContext !== undefined &&
			PROD_CONTEXT_PATTERN.test(i.helpfulEnv.kubeContext),
		render: () =>
			"kubectl is pointed at a prod cluster. Double-check before any apply or delete.",
	},
	{
		id: "terraform_workspace_prod",
		severity: "high",
		category: "safety",
		momentary: false,
		template: "Terraform is on a prod workspace. Confirm the target before you apply.",
		test: (i) =>
			i.helpfulEnv.tfWorkspace !== undefined &&
			PROD_CONTEXT_PATTERN.test(i.helpfulEnv.tfWorkspace),
		render: () => "Terraform is on a prod workspace. Confirm the target before you apply.",
	},
	{
		id: "commit_on_detached",
		severity: "critical",
		category: "safety",
		momentary: true,
		template: "Committed on a detached HEAD. `git switch -c keep` before you lose it.",
		test: (i) => hot(i, "git_commit") && detached(i.git),
		render: () => "Committed on a detached HEAD. `git switch -c keep` before you lose it.",
	},
	{
		id: "dirty_detached",
		severity: "high",
		category: "safety",
		momentary: false,
		template: "Uncommitted changes on a detached HEAD. `git switch -c keep` to save them.",
		test: (i) => detached(i.git) && dirty(i.git),
		render: () => "Uncommitted changes on a detached HEAD. `git switch -c keep` to save them.",
	},
	{
		id: "force_push",
		severity: "high",
		category: "safety",
		momentary: true,
		template: "You rewrote `{branch}`'s history. Warn anyone working on it.",
		test: (i) => hot(i, "force_push"),
		render: (i) => `You rewrote \`${branchName(i.git)}\`'s history. Warn anyone working on it.`,
	},
	// ── Account & billing ──
	{
		id: "api_key_while_subscribed",
		severity: "critical",
		category: "billing",
		momentary: false,
		template: "An API key bills per token while your plan idles. Unset `ANTHROPIC_API_KEY`.",
		test: (i) => i.env.hasApiKey && i.creds !== null && i.creds.present,
		render: () =>
			"An API key bills per token while your plan idles. Unset `ANTHROPIC_API_KEY`.",
	},
	{
		id: "pay_as_you_go_near_cap",
		severity: "high",
		category: "billing",
		momentary: false,
		template: "Pay-as-you-go at ${used} of ${limit}. Raise the cap before requests stop.",
		test: (i) => i.quota.payg !== undefined && i.quota.payg.band === "critical",
		render: (i) => {
			const p = i.quota.payg;
			const used = p?.usedCredits ?? 0;
			const limit = p?.monthlyLimit ?? 0;
			return `Pay-as-you-go at $${used.toFixed(2)} of $${limit.toFixed(2)}. Raise the cap before requests stop.`;
		},
	},
	{
		id: "balance_low",
		severity: "medium",
		category: "billing",
		momentary: false,
		template: "Prepaid balance down to ${balance}. Top up before it stalls a task.",
		test: (i) => i.balance !== null && i.balance.amount < BALANCE_LOW,
		render: (i) =>
			`Prepaid balance down to $${i.balance?.amount ?? 0}. Top up before it stalls a task.`,
	},
	{
		id: "pay_as_you_go_active",
		severity: "medium",
		category: "billing",
		momentary: false,
		template: "Pay-as-you-go is on. Every request now bills on top of your plan.",
		// Only meaningful when a plan window (block/weekly) exists to bill "on top of"; a usage-based-only plan
		// (no included quota) always bills per request, so the heads-up would be noise there.
		test: (i) =>
			i.quota.payg !== undefined &&
			i.quota.payg.usedCredits > 0 &&
			(i.quota.block !== undefined || i.quota.weekly !== undefined),
		render: () => "Pay-as-you-go is on. Every request now bills on top of your plan.",
	},
	// ── Quota ──
	{
		id: "block_almost_spent",
		severity: "high",
		category: "quota",
		momentary: false,
		template: "5h limit at {pct}%, {reset} to reset. Save heavy asks for after.",
		test: (i) => i.quota.block !== undefined && i.quota.block.usedPct > QUOTA_HIGH_PCT,
		render: (i) =>
			`5h limit at ${pct(i.quota.block?.usedPct ?? 0)}, ${bare(i.quota.block?.resetIn)} to reset. Save heavy asks for after.`,
	},
	{
		id: "weekly_almost_spent",
		severity: "high",
		category: "quota",
		momentary: false,
		template: "Weekly quota {pct}% spent, {reset} to go. Ration the big requests.",
		test: (i) => i.quota.weekly !== undefined && i.quota.weekly.usedPct > QUOTA_HIGH_PCT,
		render: (i) =>
			`Weekly quota ${pct(i.quota.weekly?.usedPct ?? 0)} spent, ${bare(i.quota.weekly?.resetIn)} to go. Ration the big requests.`,
	},
	{
		id: "block_will_exhaust",
		severity: "medium",
		category: "quota",
		momentary: false,
		template: "This burn rate empties the 5h block before reset, cutting you off mid-task.",
		test: (i) =>
			i.quota.block !== undefined &&
			i.quota.block.band !== "nominal" &&
			i.quota.block.usedPct > QUOTA_PROJECT_MIN_PCT,
		render: () => "This burn rate empties the 5h block before reset, cutting you off mid-task.",
	},
	{
		id: "weekly_will_exhaust",
		severity: "medium",
		category: "quota",
		momentary: false,
		template: "At this pace the weekly quota runs dry before reset, locking you out for days.",
		test: (i) =>
			i.quota.weekly !== undefined &&
			i.quota.weekly.band !== "nominal" &&
			i.quota.weekly.usedPct > QUOTA_PROJECT_MIN_PCT,
		render: () =>
			"At this pace the weekly quota runs dry before reset, locking you out for days.",
	},
	// ── Context & compaction ──
	{
		id: "compact_urgent",
		severity: "critical",
		category: "context",
		momentary: false,
		template: "{pct}% full, auto-compact imminent. Run /compact to control the cut.",
		test: (i) => i.context.usedPct > COMPACT_URGENT_PCT,
		render: (i) =>
			`${pct(i.context.usedPct)} full, auto-compact imminent. Run /compact to control the cut.`,
	},
	{
		id: "commit_before_compact",
		severity: "high",
		category: "context",
		momentary: false,
		template: "{pct}% full with uncommitted work. Commit before a compact buries it.",
		test: (i) => i.context.usedPct > COMPACT_SOON_PCT && dirty(i.git),
		render: (i) =>
			`${pct(i.context.usedPct)} full with uncommitted work. Commit before a compact buries it.`,
	},
	{
		id: "compaction_thrash",
		severity: "high",
		category: "context",
		momentary: false,
		template: "{count} compactions deep. /clear beats another summary of summaries.",
		test: (i) => i.context.compactions >= COMPACTION_THRASH_N,
		render: (i) =>
			`${i.context.compactions} compactions deep. /clear beats another summary of summaries.`,
	},
	{
		id: "cache_inefficiency",
		severity: "high",
		category: "context",
		momentary: false,
		template: "Cache hits only {pct}%. You're re-paying for tokens already sent.",
		test: (i) =>
			i.context.cacheHitPct < CACHE_RATIO_FLOOR * 100 && i.scan.messages > CACHE_WARMUP_TURNS,
		render: (i) =>
			`Cache hits only ${pct(i.context.cacheHitPct)}. You're re-paying for tokens already sent.`,
	},
	{
		id: "compact_soon",
		severity: "medium",
		category: "context",
		momentary: false,
		template: "{pct}% context. /compact at a clean break before it's cramped.",
		test: (i) => i.context.usedPct > COMPACT_SOON_PCT,
		render: (i) =>
			`${pct(i.context.usedPct)} context. /compact at a clean break before it's cramped.`,
	},
	// ── Git state & hygiene ──
	{
		id: "merge_conflict",
		severity: "high",
		category: "git",
		momentary: false,
		template: "{count} files conflicted. List them: `git diff --name-only --diff-filter=U`.",
		test: (i) => i.git !== null && i.git.conflict > 0,
		render: (i) =>
			`${i.git?.conflict ?? 0} files conflicted. List them: \`git diff --name-only --diff-filter=U\`.`,
	},
	{
		id: "upstream_gone",
		severity: "high",
		category: "git",
		momentary: false,
		template: "Upstream gone from the remote. Re-anchor with `git push -u`.",
		test: (i) => i.git !== null && i.git.upstreamGone,
		render: () => "Upstream gone from the remote. Re-anchor with `git push -u`.",
	},
	{
		id: "pushed_to_default",
		severity: "high",
		category: "git",
		momentary: true,
		template: "Pushed straight to `{branch}`, no PR or review. Confirm that was intended.",
		test: (i) => hot(i, "git_push") && onDefault(i.git),
		render: (i) =>
			`Pushed straight to \`${branchName(i.git)}\`, no PR or review. Confirm that was intended.`,
	},
	{
		id: "commit_on_default",
		severity: "medium",
		category: "git",
		momentary: true,
		template: "Committing on `{branch}` directly. Branch off with `git switch -c`.",
		test: (i) => hot(i, "git_commit") && onDefault(i.git),
		render: (i) =>
			`Committing on \`${branchName(i.git)}\` directly. Branch off with \`git switch -c\`.`,
	},
	{
		id: "big_diff",
		severity: "medium",
		category: "git",
		momentary: false,
		template: "Large diff: +{insertions}/-{deletions}. Review in chunks.",
		test: (i) =>
			i.git !== null && Math.abs(i.git.insertions - i.git.deletions) > BIG_DIFF_LINES,
		render: (i) =>
			`Large diff: +${i.git?.insertions ?? 0}/-${i.git?.deletions ?? 0}. Review in chunks.`,
	},
	{
		id: "behind_upstream",
		severity: "medium",
		category: "git",
		momentary: false,
		template: "{behind} behind upstream. Pull before your next commit knots the merge.",
		test: (i) => behind(i.git) > 0,
		render: (i) =>
			`${behind(i.git)} behind upstream. Pull before your next commit knots the merge.`,
	},
	{
		id: "diverged",
		severity: "medium",
		category: "git",
		momentary: false,
		template: "Diverged {ahead}↑ {behind}↓. `git pull --rebase` keeps history linear.",
		test: (i) => ahead(i.git) > 0 && behind(i.git) > 0,
		render: (i) =>
			`Diverged ${ahead(i.git)}↑ ${behind(i.git)}↓. \`git pull --rebase\` keeps history linear.`,
	},
	{
		id: "dirty_default_branch",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Working on `{branch}` directly. Branch off with `git switch -c`.",
		test: (i) => dirty(i.git) && onDefault(i.git),
		render: (i) =>
			`Working on \`${branchName(i.git)}\` directly. Branch off with \`git switch -c\`.`,
	},
	{
		id: "unpushed_commits",
		severity: "low",
		category: "git",
		momentary: false,
		template: "{ahead} commits only on this machine. Push before a disk failure eats them.",
		test: (i) => ahead(i.git) > 0,
		render: (i) =>
			`${ahead(i.git)} commits only on this machine. Push before a disk failure eats them.`,
	},
	{
		id: "no_upstream",
		severity: "low",
		category: "git",
		momentary: false,
		template: "No upstream set. `git push -u origin HEAD` to track it.",
		test: (i) => i.git !== null && i.git.branch !== undefined && !i.git.upstream,
		render: () => "No upstream set. `git push -u origin HEAD` to track it.",
	},
	{
		id: "many_untracked",
		severity: "low",
		category: "git",
		momentary: false,
		template: "{count} untracked files hide real changes. Add the keepers, ignore the rest.",
		test: (i) => i.git !== null && i.git.untracked.length >= UNTRACKED_N,
		render: (i) =>
			`${i.git?.untracked.length ?? 0} untracked files hide real changes. Add the keepers, ignore the rest.`,
	},
	{
		id: "stash_pileup",
		severity: "low",
		category: "git",
		momentary: false,
		template: "{count} stashes piling up. List with `git stash list`, drop the stale ones.",
		test: (i) => i.git !== null && i.git.stash >= STASH_N,
		render: (i) =>
			`${i.git?.stash ?? 0} stashes piling up. List with \`git stash list\`, drop the stale ones.`,
	},
	{
		id: "stale_branch",
		severity: "low",
		category: "git",
		momentary: false,
		template: "{behind} behind `{default}`. Sync before the rebase gets ugly.",
		test: (i) => i.git?.behindDefault !== undefined && i.git.behindDefault > STALE_BRANCH_N,
		render: (i) =>
			`${i.git?.behindDefault ?? 0} behind \`${cut(i.git?.defaultBranch ?? "main")}\`. Sync before the rebase gets ugly.`,
	},
	{
		id: "rebase_in_progress",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Rebase paused. `git rebase --continue` when fixed, or `--abort`.",
		test: (i) => i.git?.operation === "rebase",
		render: () => "Rebase paused. `git rebase --continue` when fixed, or `--abort`.",
	},
	{
		id: "merge_in_progress",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Merge half-done. `git merge --continue`, or `--abort` to back out.",
		test: (i) => i.git?.operation === "merge",
		render: () => "Merge half-done. `git merge --continue`, or `--abort` to back out.",
	},
	{
		id: "cherry_pick_in_progress",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Cherry-pick paused. `git cherry-pick --continue`, or `--abort`.",
		test: (i) => i.git?.operation === "cherry_pick",
		render: () => "Cherry-pick paused. `git cherry-pick --continue`, or `--abort`.",
	},
	{
		id: "revert_in_progress",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Revert paused. `git revert --continue`, or `--abort` to undo.",
		test: (i) => i.git?.operation === "revert",
		render: () => "Revert paused. `git revert --continue`, or `--abort` to undo.",
	},
	{
		id: "submodule_uninitialized",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Submodule `{name}` is empty. `git submodule update --init`.",
		test: (i) => i.git?.uninitializedSubmodule !== undefined,
		render: (i) =>
			`Submodule \`${cut(i.git?.uninitializedSubmodule ?? "")}\` is empty. \`git submodule update --init\`.`,
	},
	{
		id: "detached_head",
		severity: "low",
		category: "git",
		momentary: false,
		template: "Detached HEAD. Branch before committing or new commits can vanish.",
		test: (i) =>
			detached(i.git) &&
			i.git !== null &&
			i.git.staged + i.git.unstaged + i.git.conflict === 0,
		render: () => "Detached HEAD. Branch before committing or new commits can vanish.",
	},
	// ── Workflow ──
	{
		id: "todo_stalled",
		severity: "medium",
		category: "workflow",
		momentary: false,
		template: "Same todo open for {dur}. Stuck, or just forgot to check it off?",
		test: (i) =>
			i.scan.inProgressSinceMs !== undefined &&
			(i.nowMs - i.scan.inProgressSinceMs) / 60_000 > TODO_STALLED_MIN,
		render: (i) =>
			`Same todo open for ${fmtGap(i.nowMs - (i.scan.inProgressSinceMs ?? i.nowMs))}. Stuck, or just forgot to check it off?`,
	},
	{
		id: "effort_low",
		severity: "low",
		category: "workflow",
		momentary: false,
		template: "Effort on low. Hard problems get shallow answers.",
		test: (i) => i.payload.effort?.level === EFFORT_LOW_LEVEL,
		render: () => "Effort on low. Hard problems get shallow answers.",
	},
];
