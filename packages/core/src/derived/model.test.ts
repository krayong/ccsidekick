import { expect, test } from "bun:test";

import type { Payload, TranscriptScan } from "../sources";

import { deriveModel } from "./model";
import type { ProviderInfo } from "./provider";

const base: Payload = { workspace: {}, model: {} };

const EMPTY_SCAN: TranscriptScan = {
	tokens: { input: 0, output: 0, cache_read: 0, cache_creation_5m: 0, cache_creation_1h: 0 },
	messages: 0,
	compactions: 0,
	todos: [],
	burn: [],
	mtime: 0,
	size: 0,
};

const provider = (modelName: string): ProviderInfo => ({
	provider: "subscription",
	hasQuota: true,
	modelName,
	badge: "",
});

test("strips a leading 'Claude ' from the name and humanizes context size", () => {
	const payload: Payload = { ...base, context_window: { context_window_size: 1_000_000 } };
	const m = deriveModel(payload, provider("Claude Opus 4.8"), EMPTY_SCAN);
	expect(m.name).toBe("Opus 4.8");
	expect(m.contextLabel).toBe("1M");
});

test("strips a trailing context parenthetical from the name so it is not doubled", () => {
	// Bedrock resolves display_name to e.g. "Opus 4.8 (1M context)"; the context size renders separately as
	// contextLabel, so the parenthetical must be dropped to avoid "Opus 4.8 (1M context) (1M)".
	const payload: Payload = { ...base, context_window: { context_window_size: 1_000_000 } };
	const m = deriveModel(payload, provider("Opus 4.8 (1M context)"), EMPTY_SCAN);
	expect(m.name).toBe("Opus 4.8");
	expect(m.contextLabel).toBe("1M");
});

test("contextLabel is empty when no positive size is reported", () => {
	expect(deriveModel(base, provider("Claude Opus 4.8"), EMPTY_SCAN).contextLabel).toBe("");
	expect(
		deriveModel(
			{ ...base, context_window: { context_window_size: 0 } },
			provider("Claude Opus"),
			EMPTY_SCAN,
		).contextLabel,
	).toBe("");
});

test("name keeps a non-'Claude ' prefix verbatim", () => {
	expect(deriveModel(base, provider("Opus 4.8"), EMPTY_SCAN).name).toBe("Opus 4.8");
});

test("fast comes from the transcript scan speed, not the payload", () => {
	expect(deriveModel(base, provider("X"), EMPTY_SCAN).fast).toBe(false);
	expect(deriveModel(base, provider("X"), { ...EMPTY_SCAN, speed: "fast" }).fast).toBe(true);
	expect(deriveModel(base, provider("X"), { ...EMPTY_SCAN, speed: "slow" }).fast).toBe(false);
});

test("effort / thinking / outputStyle / agentName carry from the payload", () => {
	const payload: Payload = {
		...base,
		effort: { level: "high" },
		thinking: { enabled: true },
		output_style: { name: "concise" },
		agent: { name: "reviewer" },
	};
	const m = deriveModel(payload, provider("X"), EMPTY_SCAN);
	expect(m.effort).toBe("high");
	expect(m.thinking).toBe(true);
	expect(m.outputStyle).toBe("concise");
	expect(m.agentName).toBe("reviewer");
});

test("optional payload fields are omitted, not undefined-valued", () => {
	const m = deriveModel(base, provider("X"), EMPTY_SCAN);
	expect("effort" in m).toBe(false);
	expect("outputStyle" in m).toBe(false);
	expect("agentName" in m).toBe(false);
	expect(m.thinking).toBe(false);
});
