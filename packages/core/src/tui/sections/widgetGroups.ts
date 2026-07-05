// The six-group + Format widget taxonomy: the single source of truth the Statusline rail
// (and its detail pane) renders from. Every WidgetId belongs to exactly one group; Format
// holds no WidgetIds — its two rows are the line-level currency/budget fields.

import type { WidgetId } from "../../domain";

type WidgetGroupName = "Format" | "Git" | "Model" | "Context" | "Cost" | "Usage" | "Session";

interface WidgetGroup {
	readonly name: WidgetGroupName;
	readonly widgets: readonly WidgetId[];
}

export const WIDGET_GROUPS: readonly WidgetGroup[] = [
	{ name: "Format", widgets: [] },
	{
		name: "Git",
		widgets: [
			"git_branch",
			"git_hash",
			"git_tag",
			"git_worktree",
			"git_changes",
			"git_ahead_behind",
			"git_status",
			"git_conflict",
			"git_operation",
			"git_stash",
			"pr",
		],
	},
	{
		name: "Model",
		widgets: ["model", "fast_mode", "thinking", "output_style", "agent"],
	},
	{
		name: "Context",
		widgets: ["context_usage", "compactions", "cache_hit", "token_burn"],
	},
	{
		name: "Cost",
		widgets: ["cost_chat", "cost_project", "cost_total", "cost_burn"],
	},
	{
		name: "Usage",
		widgets: ["block_usage", "weekly_usage", "balance", "pay_as_you_go"],
	},
	{
		name: "Session",
		widgets: ["dir", "added_dirs", "session_name", "session_duration", "todo"],
	},
];

export const WIDGET_DESCRIPTIONS: Readonly<Record<WidgetId, string>> = {
	git_branch: "The current branch name.",
	git_hash: "The current commit's short hash.",
	git_tag: "The tag pointing at the current commit, if any.",
	git_worktree: "The worktree name, if not the main working tree.",
	git_changes: "Counts of staged, unstaged, and untracked files.",
	git_ahead_behind: "Commits ahead of and behind the upstream branch.",
	git_status: "Whether the working tree is clean or dirty.",
	git_conflict: "Whether there are unresolved merge conflicts.",
	git_operation: "An in-progress rebase, merge, cherry-pick, or bisect.",
	git_stash: "The number of stashed changesets.",
	pr: "The pull request associated with the current branch.",
	model: "The active Claude model.",
	fast_mode: "Whether fast mode is enabled.",
	thinking: "The active thinking/reasoning level.",
	output_style: "The active output style.",
	agent: "The active subagent, if one is running.",
	context_usage: "The fraction of the context window used.",
	compactions: "The number of context compactions this session.",
	cache_hit: "The prompt cache hit rate.",
	token_burn: "The token consumption rate.",
	cost_chat: "This chat's token cost.",
	cost_project: "This project's token cost.",
	cost_total: "Total token cost across all projects.",
	cost_burn: "The cost accrual rate.",
	block_usage: "Usage against the current five-hour billing block.",
	weekly_usage: "Weekly quota used, for subscription plans.",
	balance: "The remaining pay-as-you-go balance.",
	pay_as_you_go: "Spend against the pay-as-you-go budget.",
	dir: "The current working directory.",
	added_dirs: "Additional directories added to the session.",
	session_name: "The session's name.",
	session_duration: "How long the session has been running.",
	todo: "The active todo list's progress.",
};
