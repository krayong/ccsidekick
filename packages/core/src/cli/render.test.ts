import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import type { Field, TermContext } from "../domain";
import { loadPack } from "../packs";
import { resolveTheme } from "../render";
import { fixedClock, loadConfig } from "../sources";

import { applyThemeIcons, makePackThemeLookup, runRender } from "./render";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const PAYLOAD = JSON.stringify({
	session_id: "t",
	transcript_path: "",
	cwd: "/tmp",
	workspace: { current_dir: "/tmp" },
	model: { id: "claude-opus-4-1", display_name: "Opus 4.1" },
});
const TERM: TermContext = { columns: 400, noColor: true, isTTY: false };

function freshEnv(): NodeJS.ProcessEnv {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsk-render-")));
	writeFileSync(join(dir, "config.toml"), "");
	return { CLAUDE_CONFIG_DIR: dir };
}

test("makePackThemeLookup reuses the loaded persona pack and memoizes other names", () => {
	let calls = 0;
	const spyLoad = (n: string): ReturnType<typeof loadPack> => {
		calls += 1;
		return loadPack(n);
	};
	const loaded = loadPack("batman");
	const lookup = makePackThemeLookup("batman", loaded, spyLoad);

	// The three surface resolutions under the default sentinel all name the persona: reuse `loaded`, never load.
	lookup("batman");
	lookup("batman");
	lookup("batman");
	expect(calls).toBe(0);

	// A non-persona name loads exactly once, then serves from the memo.
	lookup("spiderman");
	lookup("spiderman");
	expect(calls).toBe(1);
});

/** One priced assistant transcript line for the Project-cost seeding test. */
function usageLine(session: string, id: string, req: string, input: number, ts: string): string {
	return JSON.stringify({
		type: "assistant",
		sessionId: session,
		requestId: req,
		timestamp: ts,
		message: {
			id,
			model: "claude-opus-4-8",
			usage: {
				input_tokens: input,
				output_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
	});
}

test("Project cost keys off the transcript dir, so a subdirectory cwd still matches sibling sessions", () => {
	// A session filed under `-Users-x-repo` with a priced sibling: Project must include the sibling whether the
	// live cwd is the repo root or a subdirectory. A `cd` moves `current_dir` but not the transcript's dir, and
	// keying Project off the live cwd would match no sibling and collapse Project to just this session's Chat.
	const env = freshEnv();
	const cfgDir = env["CLAUDE_CONFIG_DIR"] as string;
	const proj = join(cfgDir, "projects", "-Users-x-repo");
	mkdirSync(proj, { recursive: true });
	writeFileSync(
		join(proj, "sib.jsonl"),
		`${usageLine("sib", "m-sib", "r1", 100_000, "2026-01-01T00:00:00.000Z")}\n`,
	);
	writeFileSync(
		join(proj, "cur.jsonl"),
		`${usageLine("cur", "m-cur", "r2", 10, "2026-01-01T00:01:00.000Z")}\n`,
	);
	const clock = fixedClock(Date.parse("2026-01-01T01:00:00.000Z"), "UTC");

	const projectCost = (currentDir: string): string => {
		const payload = JSON.stringify({
			session_id: "cur",
			transcript_path: join(proj, "cur.jsonl"),
			cwd: currentDir,
			workspace: { current_dir: currentDir },
			model: { id: "claude-opus-4-8", display_name: "Opus 4.8" },
		});
		const line = runRender(payload, env, TERM, clock).line;
		return /Project Cost: (\$[\d.,]+)/.exec(line)?.[1] ?? "";
	};

	const atRoot = projectCost("/Users/x/repo");
	expect(atRoot).not.toBe("$0.00"); // the sibling's cost is present
	expect(projectCost("/Users/x/repo/subdir")).toBe(atRoot); // and survives a subdirectory cwd
});

test("overrides.creds forces the team provider badge without reading real creds", () => {
	const env = freshEnv();
	const clock = fixedClock(1_760_000_000_000, "UTC");
	const withTeam = runRender(PAYLOAD, env, TERM, clock, {
		creds: { present: true, subscriptionType: "team" },
	}).line;
	expect(withTeam).toContain("Team");

	const noOverride = runRender(PAYLOAD, env, TERM, clock).line;
	expect(noOverride).not.toContain("Team");
});

test("an empty overrides object leaves output identical to no overrides", () => {
	const env = freshEnv();
	const clock = fixedClock(1_760_000_000_000, "UTC");
	expect(runRender(PAYLOAD, env, TERM, clock, {}).line).toBe(
		runRender(PAYLOAD, env, TERM, clock).line,
	);
});

test("a [theme.icons] git_operation override themes only the op glyph, not the folded conflict", () => {
	// The git_operation field folds the conflict warning in as a second icon segment; a git_operation icon
	// override must theme only the op glyph and leave the conflict warning resolved via its own git_conflict key.
	const config = loadConfig('[theme.icons]\ngit_operation = "OP"\n', "");
	const theme = resolveTheme(config, () => null);
	const fields: Field[] = [
		{
			id: "git_operation",
			segments: [
				{ role: "icon", text: "🌀", signal: "caution" },
				{ role: "value", text: "rebase", signal: "caution" },
				{ role: "separator", text: "✦" },
				{ role: "icon", text: "⚠️", signal: "critical" },
				{ role: "value", text: "2", signal: "critical" },
			],
		},
	];
	const [out] = applyThemeIcons(fields, theme, config);
	const icons = (out?.segments ?? []).filter((s) => s.role === "icon").map((s) => s.text);
	expect(icons).toEqual(["OP", "⚠️"]); // op glyph themed; conflict warning survives
});
