export const MOODS = ["idle", "busy", "happy", "struggling", "recovery"] as const;
export type Mood = (typeof MOODS)[number];

export const PRESSURE_MOODS = ["compact_hint", "block_limit", "weekly_limit"] as const;
export type PressureMood = (typeof PRESSURE_MOODS)[number];

export const TIERS = ["stranger", "acquaintance", "friend", "partner", "legend"] as const;
export type Tier = (typeof TIERS)[number];

export const STACKS = [
	"web",
	"python",
	"sql",
	"web-framework",
	"docker",
	"java",
	"go",
	"node",
	"dotnet",
	"cpp",
	"php",
	"rust",
	"kubernetes",
	"ml",
	"android",
	"ruby",
	"ios",
	"terraform",
	"graphql",
	"flutter",
	"react-native",
	"scala",
	"protobuf",
	"game",
	"docs",
	"r",
	"cuda",
] as const;
export type Stack = (typeof STACKS)[number];

// Full classifier vocabulary (outcome-named, 31 members). Written to events.jsonl.
export const EVENT_CATEGORIES = [
	"test_pass",
	"test_fail",
	"build_pass",
	"build_fail",
	"typecheck_pass",
	"typecheck_fail",
	"lint",
	"format",
	"install",
	"git_commit",
	"git_push",
	"git_pull",
	"git_merge",
	"git_rebase",
	"git_branch",
	"git_tag",
	"git_stash",
	"force_push",
	"dangerous",
	"file_edit",
	"file_read",
	"search",
	"web_fetch",
	"todo_update",
	"agent_spawn",
	"skill_run",
	"docker",
	"k8s",
	"deploy",
	"db_migrate",
	"server_start",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// The 18-member pack `event` key set (lines.event). The 8 git_* + force_push collapse to `git`; the 3 *_pass
// feed happy mood with no cell; file_read + server_start are mood-only. This is distinct from the 31 EventCategory.
export const REACTION_CATEGORIES = [
	"test_fail",
	"build_fail",
	"typecheck_fail",
	"lint",
	"format",
	"install",
	"git",
	"file_edit",
	"search",
	"web_fetch",
	"todo_update",
	"agent_spawn",
	"skill_run",
	"docker",
	"k8s",
	"deploy",
	"db_migrate",
	"dangerous",
] as const;
export type ReactionCategory = (typeof REACTION_CATEGORIES)[number];

export const SEVERITIES = ["none", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Mantle is the Bedrock Mantle *endpoint*, resolved to the `bedrock` provider — not a distinct provider.
export const PROVIDERS = [
	"bedrock",
	"vertex",
	"foundry",
	"proxy",
	"ci",
	"api",
	"team",
	"enterprise",
	"subscription",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const isStack = (s: string): s is Stack => (STACKS as readonly string[]).includes(s);
export const isEventCategory = (s: string): s is EventCategory =>
	(EVENT_CATEGORIES as readonly string[]).includes(s);
