import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { scanTranscript, systemClock } from "../../../src/sources";
import { basePayload, previewEnv, scratchRoot, seedCostFixture } from "../../../src/tui/preview";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

test("basePayload carries a realistic chat cost distinct from $1.23, plus both rate-limit windows", () => {
	const p = basePayload("/tmp/work");
	expect((p["model"] as { id: string }).id).toBe("claude-opus-4-1");
	const chat = (p["cost"] as { total_cost_usd: number }).total_cost_usd;
	expect(chat).toBeGreaterThan(0);
	expect(chat).not.toBe(1.23);
	const rl = p["rate_limits"] as { five_hour: unknown; seven_day: unknown };
	expect(rl.five_hour).toBeDefined();
	expect(rl.seven_day).toBeDefined();
	expect((p["workspace"] as { current_dir: string }).current_dir).toBe("/tmp/work");
});

test("basePayload deep-merges payload overrides onto the base", () => {
	const p = basePayload("/tmp/work", {
		rate_limits: { five_hour: { used_percentage: 95, resets_at: 1 } },
	});
	const rl = p["rate_limits"] as { five_hour: { used_percentage: number }; seven_day: unknown };
	expect(rl.five_hour.used_percentage).toBe(95);
	expect(rl.seven_day).toBeDefined(); // untouched window survives the merge
});

test("basePayload omits rate_limits entirely when overridden with the null sentinel", () => {
	const p = basePayload("/tmp/work", { rate_limits: null });
	expect("rate_limits" in p).toBe(false);
});

test("basePayload seeds a current-session transcript with compactions and an in-progress todo", () => {
	const workdir = join(track(mkdtempSync(join(tmpdir(), "ccsk-fx-"))), "home", "ccsidekick");
	const p = basePayload(workdir);
	const transcriptPath = p["transcript_path"] as string;
	expect(transcriptPath).not.toBe("");
	expect(existsSync(transcriptPath)).toBe(true);

	const scan = scanTranscript(transcriptPath, systemClock, () => 0);
	expect(scan.compactions).toBeGreaterThan(0);
	expect(scan.todos.length).toBeGreaterThan(0);
	expect(scan.todos.some((t) => t.status === "in_progress")).toBe(true);
});

test("basePayload's cwd override sets both cwd and workspace.current_dir, independent of the transcript's real workdir", () => {
	const workdir = join(track(mkdtempSync(join(tmpdir(), "ccsk-fx-"))), "home", "ccsidekick");
	const p = basePayload(workdir, { cwd: "/Users/wayne/very/long/nested/project/path" });
	expect(p["cwd"]).toBe("/Users/wayne/very/long/nested/project/path");
	expect((p["workspace"] as { current_dir: string }).current_dir).toBe(
		"/Users/wayne/very/long/nested/project/path",
	);
});

test("scratchRoot returns the passed dir, or a stable shared temp dir", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsk-fx-")));
	expect(scratchRoot(dir)).toBe(dir);
	expect(scratchRoot()).toBe(scratchRoot()); // memoized, stable across calls
});

test("previewEnv pins the config dir and layers scenario env on top", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsk-fx-")));
	const env = previewEnv(dir, { ANTHROPIC_API_KEY: "sk-preview" });
	expect(env["CLAUDE_CONFIG_DIR"]).toBe(dir);
	expect(env["HOME"]).toBeDefined();
	expect(env["ANTHROPIC_API_KEY"]).toBe("sk-preview");
});

test("seedCostFixture writes two sessions, neither named after the current session", () => {
	const root = track(mkdtempSync(join(tmpdir(), "ccsk-fx-")));
	const workdir = join(root, "home", "ccsidekick");
	seedCostFixture(root, workdir);

	const currentProjectDir = join(root, "projects", workdir.replace(/[/.]/g, "-"));
	const currentSessionFile = join(currentProjectDir, "sess-a.jsonl");
	expect(existsSync(currentSessionFile)).toBe(true);
	expect(existsSync(join(currentProjectDir, "preview.jsonl"))).toBe(false);

	const line = JSON.parse(readFileSync(currentSessionFile, "utf8").trim().split("\n")[0]!) as {
		message: { model: string; usage: { input_tokens: number; output_tokens: number } };
	};
	expect(line.message.model).toBe("claude-opus-4-8");
	expect(line.message.usage.input_tokens).toBeGreaterThan(0);

	// A second session lives in a differently-named project dir, so it lifts Total but not Project.
	const otherDirs = readdirSync(join(root, "projects")).filter(
		(d) => d !== workdir.replace(/[/.]/g, "-"),
	);
	expect(otherDirs.length).toBeGreaterThan(0);
});
