import { expect, test } from "bun:test";

import { readEnv, readModelAliases } from "./env";

test("reads presence flags, not secret values", () => {
	const e = readEnv({ ANTHROPIC_API_KEY: "sk-xxx", CLAUDE_CODE_USE_BEDROCK: "1" });
	expect(e.hasApiKey).toBe(true);
	expect(e.useBedrock).toBe(true);
	expect(e.useMantle).toBe(false);
	expect(readEnv({ CLAUDE_CODE_USE_MANTLE: "1" }).useMantle).toBe(true);
	expect(e.hasAuthToken).toBe(false);
	expect((e as unknown as Record<string, unknown>)["ANTHROPIC_API_KEY"]).toBeUndefined();
});

test("customBaseUrl is an exact host compare against api.anthropic.com", () => {
	expect(readEnv({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }).customBaseUrl).toBe(false);
	expect(readEnv({ ANTHROPIC_BASE_URL: "https://proxy.example.com" }).customBaseUrl).toBe(true);
	expect(readEnv({}).customBaseUrl).toBe(false);
});

test("customBaseUrl tolerates trailing dot, path, port, and bare host", () => {
	expect(readEnv({ ANTHROPIC_BASE_URL: "https://api.anthropic.com./v1" }).customBaseUrl).toBe(
		false,
	);
	expect(readEnv({ ANTHROPIC_BASE_URL: "api.anthropic.com" }).customBaseUrl).toBe(false);
	expect(readEnv({ ANTHROPIC_BASE_URL: "proxy.example.com:8080" }).customBaseUrl).toBe(true);
	expect(readEnv({ ANTHROPIC_BASE_URL: "   " }).customBaseUrl).toBe(false);
});

test("on() accepts 1 and true only", () => {
	expect(readEnv({ CLAUDE_CODE_USE_VERTEX: "true" }).useVertex).toBe(true);
	expect(readEnv({ CLAUDE_CODE_USE_VERTEX: "1" }).useVertex).toBe(true);
	expect(readEnv({ CLAUDE_CODE_USE_VERTEX: "0" }).useVertex).toBe(false);
	expect(readEnv({ CLAUDE_CODE_USE_VERTEX: "yes" }).useVertex).toBe(false);
});

test("managedByHost and remaining provider flags", () => {
	const e = readEnv({
		CLAUDE_CODE_USE_FOUNDRY: "1",
		CLAUDE_CODE_USE_ANTHROPIC_AWS: "1",
		CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
		CLAUDE_CODE_OAUTH_TOKEN: "tok",
		ANTHROPIC_AUTH_TOKEN: "at",
	});
	expect(e.useFoundry).toBe(true);
	expect(e.useAnthropicAws).toBe(true);
	expect(e.managedByHost).toBe(true);
	expect(e.hasOauthToken).toBe(true);
	expect(e.hasAuthToken).toBe(true);
});

test("empty env yields all-false inputs", () => {
	const e = readEnv({});
	expect(Object.values(e).every((v) => v === false)).toBe(true);
});

test("readModelAliases parses CCSIDEKICK_MODEL_ALIASES into a custom-id → key map", () => {
	const m = readModelAliases({ CCSIDEKICK_MODEL_ALIASES: "my-opus=claude-opus-4-8, foo = bar " });
	expect(m.get("my-opus")).toBe("claude-opus-4-8");
	expect(m.get("foo")).toBe("bar");
	// missing var ⇒ empty map; malformed pairs (no `=`, empty side) are skipped
	expect(readModelAliases({}).size).toBe(0);
	expect(readModelAliases({ CCSIDEKICK_MODEL_ALIASES: "noeq,=onlyto,from=" }).size).toBe(0);
});
