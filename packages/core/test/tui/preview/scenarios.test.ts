import { expect, test } from "bun:test";

import { SCENARIOS, scenarioPayloadJson } from "../../../src/tui/preview";

test("the table covers env providers, creds providers, and usage states", () => {
	const labels = SCENARIOS.map((s) => s.label.toLowerCase());
	for (const want of [
		"api",
		"bedrock",
		"vertex",
		"foundry",
		"proxy",
		"ci",
		"team",
		"enterprise",
	]) {
		expect(labels.some((l) => l.includes(want))).toBe(true);
	}
	// at least one subscription (pro/max), one PAYG, one balance, one near-limit
	expect(SCENARIOS.some((s) => s.overrides?.creds?.subscriptionType === "pro")).toBe(true);
	expect(SCENARIOS.some((s) => s.overrides?.usage?.extra_usage?.is_enabled === true)).toBe(true);
	expect(SCENARIOS.some((s) => s.overrides?.balance != null)).toBe(true);
});

test("env-provider scenarios set exactly the reader's env key", () => {
	const api = SCENARIOS.find((s) => s.label.toLowerCase().includes("api"));
	expect(api?.env?.["ANTHROPIC_API_KEY"]).toBeDefined();
	const bedrock = SCENARIOS.find((s) => s.label.toLowerCase().includes("bedrock"));
	expect(bedrock?.env?.["CLAUDE_CODE_USE_BEDROCK"]).toBeDefined();
	const ci = SCENARIOS.find((s) => s.label.toLowerCase() === "ci");
	expect(ci?.env?.["CLAUDE_CODE_OAUTH_TOKEN"]).toBeDefined();
});

test("scenarioPayloadJson merges the scenario's payload overrides onto the base", () => {
	const near = SCENARIOS.find((s) => s.label === "Quota near limit");
	expect(near).toBeDefined();
	const json = scenarioPayloadJson(near!, "/tmp/wd");
	const parsed = JSON.parse(json) as { rate_limits: { five_hour: { used_percentage: number } } };
	expect(parsed.rate_limits.five_hour.used_percentage).toBeGreaterThanOrEqual(90);
});

test("cloud and api/proxy scenarios carry no quota; the subscription family keeps it", () => {
	for (const label of ["API key", "Bedrock", "Vertex", "Foundry", "Proxy"]) {
		const s = SCENARIOS.find((x) => x.label === label)!;
		expect(s.payload?.rate_limits).toBe(null);
	}
	for (const label of [
		"Team",
		"Enterprise",
		"Subscription",
		"CI",
		"Quota near limit",
		"Pay as you go",
	]) {
		const s = SCENARIOS.find((x) => x.label === label)!;
		expect(s.payload?.rate_limits).not.toBe(null);
	}
});

test("api-key and proxy scenarios carry a prepaid balance", () => {
	for (const label of ["API key", "Proxy"]) {
		const s = SCENARIOS.find((x) => x.label === label)!;
		expect(s.overrides?.balance).toBeDefined();
		expect(s.overrides?.balance?.amount).toBeGreaterThan(0);
	}
});

test("a 'Busy session' scenario exists to demo the compactions/todo widgets", () => {
	expect(SCENARIOS.some((s) => s.label === "Busy session")).toBe(true);
});

test("a long-project-path scenario exists to demo narrow-width field truncation", () => {
	const long = SCENARIOS.find((s) => s.label === "Long project path");
	expect(long).toBeDefined();
	expect(long?.payload?.cwd).toBeDefined();
	expect((long?.payload?.cwd ?? "").length).toBeGreaterThan(60);
});
