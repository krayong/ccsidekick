// The "statusline JSON with all possible values" that drives the web configurator's live preview.
//
// The real render pipeline reads its inputs from three side-effecting sources: the stdin payload, the transcript
// tree on disk (token cost, burn, todos, cache-hit), and `git`. In the browser there is no disk and no
// subprocess, so this fixture supplies a self-consistent value for every one of those inputs — a fully populated
// payload, a synthetic transcript tree (served through the fs shim), a canned `git` state (served through the
// child_process shim), and the OAuth-usage / prepaid-balance snapshots (passed as render overrides). The result
// is that every one of the 33 statusline widgets has a representative value, so toggling any widget in the
// configurator visibly changes the preview. All values are deterministic (the fixed preview clock) and
// self-consistent (cost_chat ≤ cost_project ≤ cost_total; small ahead/behind; a plausible branch and tag).

import type { RenderOverrides } from "../cli";
import type { BalanceSnapshot, UsageData } from "../sources";

/** Where the current session's transcript lives — inside the projects tree so it feeds cost AND burn/todos. */
const PROJECTS_ROOT = "/home/web/.claude/projects";
const CUR_ENCODED = "-home-web-project"; // decodes to the project key "/home/web/project"
const OTHER_ENCODED = "-home-web-other"; // a second project, contributes to Total only
export const CURRENT_TRANSCRIPT = `${PROJECTS_ROOT}/${CUR_ENCODED}/web-preview-session.jsonl`;

/** The working-tree root the canned git state reports; the `dir` widget renders it home-relativized as `~/project`. */
export const WORKTREE_ROOT = "/home/web/project";
const GIT_DIR_WORKTREE = ".git/worktrees/preview"; // a linked worktree → drives git_worktree
const MODEL_ID = "claude-sonnet-4-5";

const iso = (ms: number): string => new Date(ms).toISOString();
const jsonl = (rows: readonly unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n");

/** The fully populated Claude Code stdin payload (every payload-driven widget resolves from this). */
export function demoPayload(nowMs: number): unknown {
	return {
		session_id: "web-preview-session",
		session_name: "refactor-cost-engine",
		version: "2.0.0",
		transcript_path: CURRENT_TRANSCRIPT,
		cwd: WORKTREE_ROOT,
		workspace: {
			current_dir: WORKTREE_ROOT,
			added_dirs: ["/home/web/shared-lib", "/home/web/vendor"],
		},
		model: { id: MODEL_ID, display_name: "Sonnet 4.5" },
		output_style: { name: "Explanatory" },
		thinking: { enabled: true },
		effort: { level: "high" },
		agent: { name: "code-reviewer" },
		cost: { total_cost_usd: 1.234, total_duration_ms: 2_730_000 },
		context_window: {
			used_percentage: 62,
			total_input_tokens: 124_000,
			context_window_size: 200_000,
		},
		rate_limits: {
			five_hour: { used_percentage: 47, resets_at: Math.floor(nowMs / 1000) + 7_800 },
			seven_day: { used_percentage: 68, resets_at: Math.floor(nowMs / 1000) + 320_000 },
		},
		pr: {
			number: 1234,
			url: "https://github.com/octocat/preview/pull/1234",
			review_state: "approved",
		},
	};
}

/**
 * The current session's transcript. Two usage-bearing assistant turns inside the 5-hour burn window give
 * cost/token burn and cache-hit; a compact_boundary gives a compaction; a TodoWrite gives an in-progress todo;
 * the latest turn's `speed: "fast"` drives fast_mode. Unique `(id, requestId)` per turn so none dedup away.
 */
function currentTranscript(nowMs: number): string {
	return jsonl([
		{
			type: "assistant",
			sessionId: "web-preview-session",
			requestId: "req-1",
			timestamp: iso(nowMs - 90 * 60_000),
			message: {
				id: "msg-1",
				model: MODEL_ID,
				usage: {
					input_tokens: 12_000,
					output_tokens: 8_000,
					cache_read_input_tokens: 450_000,
					cache_creation_input_tokens: 60_000,
				},
			},
		},
		{ type: "system", subtype: "compact_boundary", timestamp: iso(nowMs - 60 * 60_000) },
		{
			type: "assistant",
			sessionId: "web-preview-session",
			requestId: "req-2",
			timestamp: iso(nowMs - 10 * 60_000),
			message: {
				id: "msg-2",
				model: MODEL_ID,
				usage: {
					input_tokens: 9_000,
					output_tokens: 15_000,
					cache_read_input_tokens: 780_000,
					cache_creation_input_tokens: 30_000,
					speed: "fast",
				},
			},
		},
		{
			type: "assistant",
			sessionId: "web-preview-session",
			requestId: "req-3",
			timestamp: iso(nowMs - 5 * 60_000),
			message: {
				id: "msg-3",
				content: [
					{
						type: "tool_use",
						name: "TodoWrite",
						input: {
							todos: [
								{ content: "Wire up the demo fixture", status: "completed" },
								{ content: "Populate every widget value", status: "in_progress" },
								{ content: "Rebuild the web bundle", status: "pending" },
							],
						},
					},
				],
			},
		},
	]);
}

/** A sibling session's transcript: one priced turn under `session`, tagged with its own ids so it isn't deduped. */
function siblingTranscript(session: string, nowMs: number, tokens: number): string {
	return jsonl([
		{
			type: "assistant",
			sessionId: session,
			requestId: `${session}-req`,
			timestamp: iso(nowMs - 26 * 60 * 60_000),
			message: {
				id: `${session}-msg`,
				model: MODEL_ID,
				usage: {
					input_tokens: Math.round(tokens * 0.02),
					output_tokens: Math.round(tokens * 0.02),
					cache_read_input_tokens: tokens,
					cache_creation_input_tokens: 0,
				},
			},
		},
	]);
}

/** The virtual files the fs shim serves: the transcript tree (cost + current session) plus a git op marker. */
export function demoFiles(nowMs: number): Record<string, string> {
	return {
		[CURRENT_TRANSCRIPT]: currentTranscript(nowMs),
		[`${PROJECTS_ROOT}/${CUR_ENCODED}/web-preview-session-2.jsonl`]: siblingTranscript(
			"web-preview-session-2",
			nowMs,
			3_000_000,
		),
		[`${PROJECTS_ROOT}/${OTHER_ENCODED}/web-preview-other.jsonl`]: siblingTranscript(
			"web-preview-other",
			nowMs,
			6_000_000,
		),
		// Presence of this dir under the worktree's git dir makes readGit report an in-progress rebase.
		[`${WORKTREE_ROOT}/${GIT_DIR_WORKTREE}/rebase-merge/interactive`]: "\n",
	};
}

/** OAuth-usage (pay_as_you_go) and prepaid-balance snapshots, injected as pipeline overrides (network is off). */
export function demoOverrides(nowMs: number): RenderOverrides {
	const usage: UsageData = {
		rate_limits: {},
		extra_usage: { used_credits: 1_250, monthly_limit: 5_000, is_enabled: true },
	};
	const balance: BalanceSnapshot = { amount: 42.5, currency: "USD", ts: nowMs };
	return { usage, balance };
}

// ── Canned git state ─────────────────────────────────────────────────────────
// A pure lookup keyed on the git subcommand+args (no real subprocess). `readGit` issues these in order; each
// returns the stdout real git would print for the demo repo. Unlisted commands return "" (readGit tolerates it).

const AHEAD_BEHIND = "# branch.ab +2 -1";
const STATUS_ENTRIES = [
	"1 M. N... 100644 100644 100644 1111111 2222222 src/app.ts", // staged
	"1 .M N... 100644 100644 100644 3333333 4444444 src/render.ts", // unstaged
	"u UU N... 100644 100644 100644 100644 5555 6666 7777 src/merge.ts", // conflict
	"? notes.todo", // untracked
].join("\n");
const NUMSTAT = ["24\t6\tsrc/app.ts", "10\t0\tsrc/render.ts", "0\t4\tsrc/old.ts"].join("\n");
const DETACHED_SHA = "9f4c1a7e2b6d8035a1c9e7f4b2d0a6c8e1f3b5d7";

/** Build the git-command lookup for a scenario: `branch` (on a feature branch) or `detached` (checked out at a tag). */
export function gitRunner(scenario: "branch" | "detached"): (args: readonly string[]) => string {
	const detached = scenario === "detached";
	const statusLines = [
		`# branch.oid ${DETACHED_SHA}`,
		detached ? "# branch.head (detached)" : "# branch.head feature/web-preview",
		...(detached ? [] : ["# branch.upstream origin/feature/web-preview", AHEAD_BEHIND]),
		"# stash 3",
		STATUS_ENTRIES,
	].join("\n");
	const gitDir = detached ? ".git" : GIT_DIR_WORKTREE;

	return (args) => {
		const key = args.join(" ");
		if (key === "rev-parse --is-inside-work-tree") return "true\n";
		if (key === "status --porcelain=v2 --branch --show-stash") return `${statusLines}\n`;
		if (key === "rev-parse --git-dir") return `${gitDir}\n`;
		if (key === "rev-parse --show-toplevel") return `${WORKTREE_ROOT}\n`;
		if (key === "describe --tags --exact-match") return "v1.2.0\n";
		if (key === "remote get-url origin") return "git@github.com:octocat/preview.git\n";
		if (key === "symbolic-ref --short refs/remotes/origin/HEAD") return "origin/main\n";
		if (key === "diff HEAD --numstat") return `${NUMSTAT}\n`;
		return "";
	};
}
