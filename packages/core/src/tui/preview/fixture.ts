// The deterministic preview environment. Stand up a throwaway config dir plus a git fixture so the real render
// pipeline (cli/render) shows realistic dir/git/usage fields, and build the synthetic payload the scenarios vary.
// Plain Node (no Ink/React): the engine pipeline must stay UI-free. This is an adapted copy of the machinery in
// tui/preview.ts, kept separate so the shipping tui/app.tsx path stays untouched.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PayloadOverrides {
	readonly rate_limits?: Record<string, unknown> | null;
	readonly cost?: Record<string, unknown>;
	/** Overrides both `cwd` and `workspace.current_dir`; the transcript/git/cost fixtures still live at the
	 *  real `workdir`, so this only changes what the rendered `dir` field (and `readGit`'s target) show. */
	readonly cwd?: string;
}

/** One `compact_boundary` system line, plus one `TodoWrite` snapshot with a completed and an in-progress
 *  item — enough for `scanTranscript` to report `compactions > 0` and a non-empty, in-progress todo list.
 *  With `root`, the transcript lands under the projects tree (`projects/<encoded workdir>/`) the way Claude
 *  Code files it, so the render's transcript-derived Project key matches the sibling seeded by
 *  `seedCostFixture`; without it (payload-only unit tests) it stays in `workdir`. */
function seedTranscriptFixture(workdir: string, root?: string): string {
	const dir =
		root !== undefined ? join(root, "projects", workdir.replace(/[/.]/g, "-")) : workdir;
	const path = join(dir, "preview-transcript.jsonl");
	try {
		mkdirSync(dir, { recursive: true });
		if (!existsSync(path)) {
			const lines = [
				JSON.stringify({ type: "system", subtype: "compact_boundary" }),
				JSON.stringify({
					message: {
						content: [
							{
								type: "tool_use",
								name: "TodoWrite",
								input: {
									todos: [
										{ content: "Ship the preview polish", status: "completed" },
										{
											content: "Wire up the compaction widget",
											status: "in_progress",
										},
									],
								},
							},
						],
					},
				}),
			];
			writeFileSync(path, `${lines.join("\n")}\n`);
		}
	} catch {
		// Preview renders with compactions/todos empty on any failure.
	}
	return path;
}

/**
 * A fixed, realistic statusline payload: model, context, and a session cost the preview can color. Payload
 * overrides deep-merge onto the two nested objects a scenario varies (rate_limits, cost). `rate_limits` defaults
 * to the two rate-limit windows so the usage row renders (`resets_at` is epoch seconds, the renderer multiplies
 * by 1000; the values sit ahead of the preview's fixed clock so countdowns are positive); passing the `null`
 * sentinel omits `rate_limits` from the payload entirely, for providers that carry no quota.
 */
export function basePayload(
	workdir: string,
	over: PayloadOverrides = {},
	root?: string,
): Record<string, unknown> {
	const cost = { total_cost_usd: 0.42, total_duration_ms: 3_600_000, ...over.cost };
	const cwd = over.cwd ?? workdir;
	const base: Record<string, unknown> = {
		session_id: "preview",
		session_name: "preview",
		transcript_path: seedTranscriptFixture(workdir, root),
		cwd,
		workspace: { current_dir: cwd },
		model: { id: "claude-opus-4-1", display_name: "Opus 4.1" },
		output_style: { name: "default" },
		context_window: {
			used_percentage: 42,
			total_input_tokens: 84_000,
			context_window_size: 200_000,
		},
		cost,
	};
	if (over.rate_limits === null) return base;
	return {
		...base,
		rate_limits: {
			five_hour: { used_percentage: 18, resets_at: 1_728_050_400 },
			seven_day: { used_percentage: 61, resets_at: 1_728_302_400 },
			...over.rate_limits,
		},
	};
}

// Git's repo-location env vars leak into a subprocess from a parent or a git hook and would point the fixture at
// the user's outer repo; strip them and pin config to /dev/null so the scratch repo is deterministic.
export function gitEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
	);
	env["GIT_CONFIG_GLOBAL"] = "/dev/null";
	env["GIT_CONFIG_SYSTEM"] = "/dev/null";
	return env;
}

/**
 * Stand up a throwaway git repo in the preview workdir so the renderer (which reads git from disk, not the
 * payload) shows realistic branch/changes/status. Idempotent: returns once `.git` exists. Best-effort: any git
 * failure is swallowed and the preview still renders (the renderer degrades without git).
 */
export function setupGitFixture(workdir: string): void {
	try {
		mkdirSync(workdir, { recursive: true });
		if (existsSync(join(workdir, ".git"))) return;
		const env = gitEnv();
		const git = (...args: string[]): void => {
			execFileSync("git", args, { cwd: workdir, env, stdio: "ignore" });
		};
		git("init", "-q", "-b", "main");
		git("config", "user.email", "wayne@example.com");
		git("config", "user.name", "Bruce Wayne");
		git("remote", "add", "origin", "https://github.com/wayne/ccsidekick.git");
		writeFileSync(join(workdir, "README.md"), "# ccsidekick\n\noriginal line\nkeep me\n");
		git("add", "README.md");
		git("commit", "-q", "-m", "initial commit");
		writeFileSync(
			join(workdir, "README.md"),
			"# ccsidekick\n\nedited line\nkeep me\nnew line\n",
		);
		writeFileSync(join(workdir, "src.ts"), "export const answer = 42;\n");
		git("add", "src.ts");
	} catch {
		// Preview renders without git on any failure.
	}
}

/** One synthetic, token-priced transcript line: a real pricing-table model key plus usage the pricer sums. */
function transcriptLine(
	id: string,
	model: string,
	inputTokens: number,
	outputTokens: number,
): string {
	return JSON.stringify({
		message: {
			id,
			model,
			usage: {
				input_tokens: inputTokens,
				output_tokens: outputTokens,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		requestId: `req-${id}`,
		timestamp: "2024-06-01T00:00:00.000Z",
	});
}

/**
 * Seed the scratch projects tree the real render pipeline scans (`scanCostTree`, rooted at
 * `dirname(configRoot)/projects`, a sibling of the `ccsidekick` config dir) with two synthetic sessions, so the
 * preview's Project and Total cost fields lift above Chat instead of echoing it. Neither file is named after the
 * current session (`"preview"`), so both price as separate sessions: one lands in the current project's encoded
 * dir (lifting Project + Total), the other in an unrelated project dir (lifting Total only).
 */
export function seedCostFixture(root: string, workdir: string): void {
	const projectsRoot = join(root, "projects");
	const currentProjectDir = join(projectsRoot, workdir.replace(/[/.]/g, "-"));
	const otherProjectDir = join(projectsRoot, "-other-project");
	mkdirSync(currentProjectDir, { recursive: true });
	mkdirSync(otherProjectDir, { recursive: true });
	writeFileSync(
		join(currentProjectDir, "sess-a.jsonl"),
		`${transcriptLine("sess-a-1", "claude-opus-4-8", 100_000, 20_000)}\n`,
	);
	writeFileSync(
		join(otherProjectDir, "sess-b.jsonl"),
		`${transcriptLine("sess-b-1", "claude-opus-4-8", 200_000, 50_000)}\n`,
	);
}

let sharedScratch: string | undefined;
export function scratchRoot(scratchDir?: string): string {
	if (scratchDir !== undefined) return scratchDir;
	sharedScratch ??= mkdtempSync(join(tmpdir(), "ccsidekick-preview-"));
	return sharedScratch;
}

/**
 * Build the env for a preview render: pin CLAUDE_CONFIG_DIR to the scratch root and HOME to a realpath-resolved
 * subdir (so the dir field relativizes to a short `~/ccsidekick`), then layer the scenario's env on top so its
 * provider keys drive `readEnv`.
 */
export function previewEnv(root: string, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const homeBase = join(root, "home");
	mkdirSync(homeBase, { recursive: true });
	let home = homeBase;
	try {
		home = realpathSync(homeBase);
	} catch {
		// Fall back to the unresolved path; the dir field then shows the absolute path.
	}
	return { CLAUDE_CONFIG_DIR: root, HOME: home, ...extra };
}
