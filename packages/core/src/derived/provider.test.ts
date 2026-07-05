import { expect, test } from "bun:test";

import type { CredsInfo, EnvInputs, Payload } from "../sources";

import { deriveProvider } from "./provider";

const base: Payload = { workspace: {}, model: {} };

const noEnv: EnvInputs = {
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
};

const model = (m: Payload["model"]): Payload => ({ ...base, model: m });

test("detection order + model name + plan alias", () => {
	const env: EnvInputs = { ...noEnv, useBedrock: true };
	expect(deriveProvider(env, model({ id: "opusplan" }), null, false).provider).toBe("bedrock");
	expect(deriveProvider(env, model({ id: "opusplan" }), null, false).modelName).toBe(
		"Claude Opus",
	);

	// Mantle / AnthropicAws fold into bedrock (no distinct provider), no quota:
	const mantle: EnvInputs = { ...noEnv, useMantle: true };
	expect(deriveProvider(mantle, model({}), null, false).provider).toBe("bedrock");
	expect(deriveProvider(mantle, model({}), null, false).hasQuota).toBe(false);
	const aws: EnvInputs = { ...noEnv, useAnthropicAws: true };
	expect(deriveProvider(aws, model({}), null, false).provider).toBe("bedrock");

	// display_name wins over the plan alias:
	expect(
		deriveProvider(noEnv, model({ display_name: "Claude Opus 4.8" }), null, false).modelName,
	).toBe("Claude Opus 4.8");
	// raw id when neither display_name nor an alias match:
	expect(deriveProvider(noEnv, model({ id: "claude-opus-4-8" }), null, false).modelName).toBe(
		"claude-opus-4-8",
	);

	// managedByHost suppresses env-based detection (would otherwise read bedrock):
	expect(
		deriveProvider({ ...env, managedByHost: true }, model({}), null, false).provider,
	).not.toBe("bedrock");
});

test("full env precedence chain (bedrock → vertex → foundry → proxy → ci → api)", () => {
	expect(deriveProvider({ ...noEnv, useVertex: true }, base, null, false).provider).toBe(
		"vertex",
	);
	expect(deriveProvider({ ...noEnv, useFoundry: true }, base, null, false).provider).toBe(
		"foundry",
	);
	expect(deriveProvider({ ...noEnv, hasAuthToken: true }, base, null, false).provider).toBe(
		"proxy",
	);
	expect(deriveProvider({ ...noEnv, customBaseUrl: true }, base, null, false).provider).toBe(
		"proxy",
	);
	expect(deriveProvider({ ...noEnv, hasOauthToken: true }, base, null, false).provider).toBe(
		"ci",
	);
	expect(deriveProvider({ ...noEnv, hasApiKey: true }, base, null, false).provider).toBe("api");
	// bedrock beats vertex when both set:
	expect(
		deriveProvider({ ...noEnv, useBedrock: true, useVertex: true }, base, null, false).provider,
	).toBe("bedrock");
});

test("creds subscriptionType → team / enterprise, else subscription", () => {
	const team: CredsInfo = { present: true, subscriptionType: "team" };
	const ent: CredsInfo = { present: true, subscriptionType: "enterprise" };
	const max: CredsInfo = { present: true, subscriptionType: "max" };
	expect(deriveProvider(noEnv, base, team, false).provider).toBe("team");
	expect(deriveProvider(noEnv, base, ent, false).provider).toBe("enterprise");
	expect(deriveProvider(noEnv, base, max, false).provider).toBe("subscription");
	expect(deriveProvider(noEnv, base, null, false).provider).toBe("subscription");
});

test("hasQuota: no-quota backends are always false", () => {
	const withLimits: Payload = { ...base, rate_limits: { five_hour: { used_percentage: 10 } } };
	for (const env of [
		{ ...noEnv, useBedrock: true },
		{ ...noEnv, useVertex: true },
		{ ...noEnv, useFoundry: true },
		{ ...noEnv, hasAuthToken: true },
		{ ...noEnv, hasApiKey: true },
	]) {
		expect(deriveProvider(env, withLimits, null, true).hasQuota).toBe(false);
	}
});

test("hasQuota: quota backends true when rate_limits present", () => {
	const withLimits: Payload = { ...base, rate_limits: { five_hour: { used_percentage: 10 } } };
	expect(deriveProvider(noEnv, withLimits, null, true).hasQuota).toBe(true);
});

test("hasQuota: no-quota heuristic — assistant turn exists but rate_limits stripped ⇒ false", () => {
	// rate_limits absent + an assistant turn already happened ⇒ relay stripped them ⇒ no-quota.
	expect(deriveProvider(noEnv, base, null, true).hasQuota).toBe(false);
	// rate_limits absent but no assistant turn yet ⇒ stay optimistic (OAuth fallback may supply).
	expect(deriveProvider(noEnv, base, null, false).hasQuota).toBe(true);
});

test("badge carries the fixed ` | ` lead-in; subscription is hidden", () => {
	expect(deriveProvider({ ...noEnv, useBedrock: true }, base, null, false).badge).toBe(
		"🪨 Bedrock | ",
	);
	expect(deriveProvider({ ...noEnv, hasApiKey: true }, base, null, false).badge).toBe(
		"🔑 API | ",
	);
	expect(deriveProvider(noEnv, base, null, false).badge).toBe("");
});
