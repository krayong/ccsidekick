// The preview scenario table: each entry drives the real render pipeline into a distinct provider or billing
// state, entirely offline. Env keys yield the env-derived providers; `overrides.creds` yields the creds-derived
// ones; `overrides.usage`/`overrides.balance` and the payload's rate_limits yield the usage states. Pure data.

import type { RenderOverrides } from "../../cli";

import { type PayloadOverrides, basePayload } from "./fixture";

export interface Scenario {
	readonly label: string;
	readonly payload?: PayloadOverrides;
	readonly env?: NodeJS.ProcessEnv;
	readonly overrides?: RenderOverrides;
}

const creds = (subscriptionType: "pro" | "max" | "team" | "enterprise"): RenderOverrides => ({
	creds: { present: true, subscriptionType },
});

export const SCENARIOS: readonly Scenario[] = [
	// Carries synthetic creds alongside the key so the preview stays offline and deterministic: without it the
	// render path reads real machine creds (keychain / creds file), which is neither sandboxed by the preview env
	// nor reproducible. `present` also demos the api-key-while-subscribed billing warning, which is the point of
	// showing an API-key state. The provider badge stays `api` (detectProvider keys off the env before creds).
	{
		label: "API key",
		env: { ANTHROPIC_API_KEY: "sk-ant-preview" },
		payload: { rate_limits: null },
		overrides: {
			creds: { present: true },
			balance: { amount: 18.4, currency: "USD", ts: 1_728_050_400_000 },
		},
	},
	{ label: "Bedrock", env: { CLAUDE_CODE_USE_BEDROCK: "1" }, payload: { rate_limits: null } },
	{ label: "Vertex", env: { CLAUDE_CODE_USE_VERTEX: "1" }, payload: { rate_limits: null } },
	{ label: "Foundry", env: { CLAUDE_CODE_USE_FOUNDRY: "1" }, payload: { rate_limits: null } },
	{
		label: "Proxy",
		env: { ANTHROPIC_AUTH_TOKEN: "proxy-token" },
		payload: { rate_limits: null },
		overrides: { balance: { amount: 18.4, currency: "USD", ts: 1_728_050_400_000 } },
	},
	{ label: "CI", env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-token" } },
	{ label: "Team", overrides: creds("team") },
	{ label: "Enterprise", overrides: creds("enterprise") },
	{ label: "Subscription", overrides: creds("pro") },
	// The billing rows (quota bar, pay-as-you-go extra, balance) only surface on wide terminals; the
	// statusline sheds them below wide width. At the preview's default width these three scenarios
	// read identically to a plain Subscription entry.
	{
		label: "Quota near limit",
		overrides: creds("max"),
		payload: { rate_limits: { five_hour: { used_percentage: 95, resets_at: 1_728_050_400 } } },
	},
	{
		label: "Pay as you go",
		overrides: {
			...creds("pro"),
			usage: {
				rate_limits: { five_hour: { utilization: 12 } },
				extra_usage: { is_enabled: true, used_credits: 8, monthly_limit: 100 },
			},
		},
	},
	{
		label: "Balance",
		overrides: {
			...creds("pro"),
			balance: { amount: 42.5, currency: "USD", ts: 1_728_050_400_000 },
		},
	},
	// A plain day-to-day session: nothing exotic about its billing state, just the obvious place to look
	// for the compactions/todo widgets (the preview force-enables both, since they default off).
	{ label: "Busy session", overrides: creds("pro") },
	// A deliberately long `dir` value: `dir` is a protected, never-drop field, so under
	// width pressure it truncates in place with an ellipsis instead of disappearing -- the one scenario
	// built to demonstrate that truncation at narrow preview widths.
	{
		label: "Long project path",
		overrides: creds("pro"),
		payload: {
			cwd: "/Users/wayne/Development/deeply/nested/monorepo/workspace/packages/ccsidekick-workspace/apps/dashboard",
		},
	},
];

/** The scenario's payload JSON: its payload overrides merged onto the base fixture for `workdir`. */
export function scenarioPayloadJson(scenario: Scenario, workdir: string): string {
	return JSON.stringify(basePayload(workdir, scenario.payload ?? {}));
}
