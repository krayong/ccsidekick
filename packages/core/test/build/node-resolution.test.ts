// Node-portability gate for the shipped hot path: build the two bundles, then run the EMITTED
// `dist/ccsidekick-render.js` under PLAIN `node` (not bun). This proves the render bundle (a) executes outside
// bun, (b) resolves the batman `pack.json` from the install layout via `import.meta.resolve`, and (c) has its
// inlined deps — smol-toml plus the JSON data assets (pricing.json, fx-fallback.json) — reachable with no
// missing-module error. Each run uses a temp `CLAUDE_CONFIG_DIR` with network disabled, so the persist tail
// never reaches the currency endpoint and the assertions stay isolated from the host `~/.claude`.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, expect, test } from "bun:test";

const packageRoot = join(import.meta.dir, "../..");
const renderBundle = join(packageRoot, "dist", "ccsidekick-render.js");
const fixtures = join(import.meta.dir, "../fixtures");

const tempDirs: string[] = [];

/** A throwaway `CLAUDE_CONFIG_DIR` whose config.toml disables the network so persist never blocks under node. */
function isolatedConfigDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-node-res-"));
	tempDirs.push(dir);
	mkdirSync(join(dir, "ccsidekick"), { recursive: true });
	writeFileSync(
		join(dir, "ccsidekick", "config.toml"),
		"schema_version = 1\n\n[network]\nfx_refresh = false\nusage_fetch = false\n",
	);
	return dir;
}

function runRenderUnderNode(payload: string, configDir: string): ReturnType<typeof spawnSync> {
	return spawnSync("node", [renderBundle, "render"], {
		input: payload,
		encoding: "utf8",
		env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, COLUMNS: "120", NO_COLOR: "1" },
	});
}

beforeAll(() => {
	const built = spawnSync("bun", ["scripts/build.ts"], { cwd: packageRoot, stdio: "inherit" });
	expect(built.status).toBe(0);
});

afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

test("emitted render bundle resolves the pack under plain node", () => {
	const payload = readFileSync(join(fixtures, "payloads", "canonical.json"), "utf8");
	const out = runRenderUnderNode(payload, isolatedConfigDir());
	expect(out.status).toBe(0);
	expect(out.stdout.length).toBeGreaterThan(0);
});

test("emitted render bundle prices a transcript line under plain node (proves pricing.json inlined)", () => {
	// canonical's payload total_cost_usd short-circuits Chat cost and SKIPS the priced scan, so it can pass while
	// inlining is broken. This payload omits cost.total_cost_usd and the temp config tree carries a usage-bearing
	// assistant transcript, forcing the token-priced scan through derived/pricing ← the inlined pricing.json.
	const configDir = isolatedConfigDir();
	const projectDir = join(configDir, "projects", "-home-dev-proj");
	mkdirSync(projectDir, { recursive: true });
	cpSync(join(fixtures, "transcripts", "priced.jsonl"), join(projectDir, "sess-priced.jsonl"));

	const payload = readFileSync(join(fixtures, "payloads", "priced-transcript.json"), "utf8");
	const out = runRenderUnderNode(payload, configDir);
	expect(out.status).toBe(0);
	expect(out.stdout).toMatch(/\$\d/); // a priced cost rendered ⇒ pricing.json was inlined and reachable
});
