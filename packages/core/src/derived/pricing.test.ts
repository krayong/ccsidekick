import { expect, test } from "bun:test";

import type { Usage } from "../sources";

import { modelKeyOf, priceMessage, resolvePrice } from "./pricing";

const usage = (over: Partial<Usage>): Usage => ({
	input_tokens: 0,
	output_tokens: 0,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
	...over,
});

const M = 1_000_000;

test("a known id prices a known usage to the documented value", () => {
	// claude-opus-4-8: input $5/M, output $25/M ⇒ 1M each = $30
	const cost = priceMessage(usage({ input_tokens: M, output_tokens: M }), "claude-opus-4-8");
	expect(cost).toBeCloseTo(30, 9);
});

test("fast doubles for opus-4-8, ×6 for opus-4-7, standard (×1) for retired opus-4-6 fast", () => {
	const u = usage({ input_tokens: M, output_tokens: M, speed: "fast" });
	expect(priceMessage(u, "claude-opus-4-8")).toBeCloseTo(60, 9);
	expect(priceMessage(u, "claude-opus-4-7")).toBeCloseTo(180, 9);
	// Opus 4.6 fast mode was retired (June 29, 2026); such requests run and bill at standard rates.
	expect(priceMessage(u, "claude-opus-4-6")).toBeCloseTo(30, 9);
	// standard speed ⇒ ×1
	expect(
		priceMessage(usage({ input_tokens: M, output_tokens: M }), "claude-opus-4-8"),
	).toBeCloseTo(30, 9);
});

test("unknown id, <synthetic>, and a Bedrock ARN with no model price to 0", () => {
	expect(priceMessage(usage({ input_tokens: M }), "gpt-4o")).toBe(0);
	expect(priceMessage(usage({ input_tokens: M }), "<synthetic>")).toBe(0);
	expect(
		priceMessage(
			usage({ input_tokens: M }),
			"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abcdef123456",
		),
	).toBe(0);
	expect(resolvePrice("gpt-4o")).toBeNull();
});

test("the 5-minute and 1-hour cache writes use their own explicit rates", () => {
	// opus-4-8: 5m write $6.25/M, 1h write $10/M — distinct lanes, each read from the table.
	const c5m = usage({
		cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: 0 },
	});
	const c1h = usage({
		cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: M },
	});
	expect(priceMessage(c5m, "claude-opus-4-8")).toBeCloseTo(6.25, 9);
	expect(priceMessage(c1h, "claude-opus-4-8")).toBeCloseTo(10, 9);
});

test("Sonnet 5 uses introductory pricing before Sep 1 2026 and standard pricing from Sep 1", () => {
	const u = usage({ input_tokens: M, output_tokens: M });
	// introductory: input $2/M + output $10/M = $12
	expect(priceMessage(u, "claude-sonnet-5", undefined, Date.parse("2026-08-15"))).toBeCloseTo(
		12,
		9,
	);
	// standard from Sep 1: input $3/M + output $15/M = $18
	expect(priceMessage(u, "claude-sonnet-5", undefined, Date.parse("2026-09-01"))).toBeCloseTo(
		18,
		9,
	);
	// no timestamp ⇒ current (standard) pricing
	expect(priceMessage(u, "claude-sonnet-5")).toBeCloseTo(18, 9);
});

test("modelKeyOf canonicalizes provider id variants and passes unknown ids through", () => {
	expect(modelKeyOf("claude-opus-4-8@20260115")).toBe("claude-opus-4-8");
	expect(modelKeyOf("anthropic.claude-opus-4-8-v1:0")).toBe("claude-opus-4-8");
	expect(modelKeyOf("gpt-4o")).toBe("gpt-4o"); // unknown ⇒ itself
});

test("newly added models resolve to their documented base input prices", () => {
	// fable-5 input $10/M, opus-4-5 input $5/M, sonnet-4 input $3/M
	expect(priceMessage(usage({ input_tokens: M }), "claude-fable-5")).toBeCloseTo(10, 9);
	expect(priceMessage(usage({ input_tokens: M }), "claude-opus-4-5")).toBeCloseTo(5, 9);
	expect(priceMessage(usage({ input_tokens: M }), "claude-sonnet-4-20250514")).toBeCloseTo(3, 9);
});

test("a Vertex `@date` id resolves via the @→- substring rule", () => {
	expect(priceMessage(usage({ input_tokens: M }), "claude-opus-4-8@20260115")).toBeCloseTo(5, 9);
	expect(resolvePrice("claude-opus-4-8@20260115")).not.toBeNull();
});

test("a Bedrock `anthropic.*` id resolves via the normalized substring rule", () => {
	expect(priceMessage(usage({ input_tokens: M }), "anthropic.claude-opus-4-8-v1:0")).toBeCloseTo(
		5,
		9,
	);
});

test("an injected alias maps a custom id to a known table key", () => {
	const aliases = new Map([["my-opus", "claude-opus-4-8"]]);
	// without the alias the custom id is unknown ⇒ 0 / null
	expect(priceMessage(usage({ input_tokens: M }), "my-opus")).toBe(0);
	expect(resolvePrice("my-opus")).toBeNull();
	// with the injected alias it resolves to the opus-4-8 row (input $5/M)
	expect(priceMessage(usage({ input_tokens: M }), "my-opus", aliases)).toBeCloseTo(5, 9);
	expect(resolvePrice("my-opus", aliases)).not.toBeNull();
});
