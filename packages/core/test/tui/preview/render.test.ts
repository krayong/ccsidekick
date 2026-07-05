import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../../../src/sources";
import { renderScenario, SCENARIOS } from "../../../src/tui/preview";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

// eslint-disable-next-line no-control-regex -- ESC (\x1b) is the literal SGR introducer being stripped from rendered output
const stripSgr = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const scratch = (): string => track(mkdtempSync(join(tmpdir(), "ccsk-render-")));

test("every scenario renders a non-empty line", () => {
	const dir = scratch();
	for (const s of SCENARIOS) {
		const out = renderScenario(s, DEFAULT_CONFIG, {
			columns: 80,
			noColor: true,
			scratchDir: dir,
		});
		expect(stripSgr(out).trim().length).toBeGreaterThan(0);
	}
});

test("distinct providers produce pairwise-distinct output", () => {
	const dir = scratch();
	const distinct = [
		"API key",
		"Bedrock",
		"Vertex",
		"Foundry",
		"Proxy",
		"CI",
		"Team",
		"Enterprise",
	];
	const outputs = distinct.map((label) => {
		const s = SCENARIOS.find((x) => x.label === label)!;
		return stripSgr(
			renderScenario(s, DEFAULT_CONFIG, { columns: 100, noColor: true, scratchDir: dir }),
		);
	});
	expect(new Set(outputs).size).toBe(outputs.length);
});

test("cloud scenarios omit weekly usage while the subscription family keeps it", () => {
	const dir = scratch();
	const bedrock = SCENARIOS.find((s) => s.label === "Bedrock")!;
	const subscription = SCENARIOS.find((s) => s.label === "Subscription")!;
	const bedrockOut = stripSgr(
		renderScenario(bedrock, DEFAULT_CONFIG, { columns: 120, noColor: true, scratchDir: dir }),
	);
	const subscriptionOut = stripSgr(
		renderScenario(subscription, DEFAULT_CONFIG, {
			columns: 120,
			noColor: true,
			scratchDir: dir,
		}),
	);
	expect(bedrockOut).not.toMatch(/📅|Weekly/);
	expect(subscriptionOut).toMatch(/📅|Weekly/);
});

test("API key scenario shows a balance row, Bedrock (cloud, no balance) does not", () => {
	const dir = scratch();
	const apiKey = SCENARIOS.find((s) => s.label === "API key")!;
	const bedrock = SCENARIOS.find((s) => s.label === "Bedrock")!;
	const apiKeyOut = stripSgr(
		renderScenario(apiKey, DEFAULT_CONFIG, { columns: 120, noColor: true, scratchDir: dir }),
	);
	const bedrockOut = stripSgr(
		renderScenario(bedrock, DEFAULT_CONFIG, { columns: 120, noColor: true, scratchDir: dir }),
	);
	expect(apiKeyOut).toMatch(/💳|Balance/);
	expect(bedrockOut).not.toMatch(/💳|Balance/);
});

test("Chat, Project, and Total cost render as distinct, ascending values", () => {
	const dir = scratch();
	const s = SCENARIOS.find((x) => x.label === "Subscription")!;
	const out = stripSgr(
		renderScenario(s, DEFAULT_CONFIG, { columns: 120, noColor: true, scratchDir: dir }),
	);
	const chat = Number(/Chat Cost: \$([\d.]+)/.exec(out)?.[1]);
	const project = Number(/Project Cost: \$([\d.]+)/.exec(out)?.[1]);
	const total = Number(/Total Cost: \$([\d.]+)/.exec(out)?.[1]);
	expect([chat, project, total].every((n) => Number.isFinite(n))).toBe(true);
	expect(chat).toBeLessThan(project);
	expect(project).toBeLessThan(total);
});

test("noColor=false emits SGR, noColor=true strips it", () => {
	const dir = scratch();
	const s = SCENARIOS.find((x) => x.label === "Team")!;
	const colored = renderScenario(s, DEFAULT_CONFIG, {
		columns: 80,
		noColor: false,
		scratchDir: dir,
	});
	const plain = renderScenario(s, DEFAULT_CONFIG, {
		columns: 80,
		noColor: true,
		scratchDir: dir,
	});
	expect(colored).toContain("\x1b[");
	expect(plain).not.toContain("\x1b[");
});
