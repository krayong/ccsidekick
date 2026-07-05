import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import type { Field, TermContext } from "../domain";
import { resolveTheme } from "../render";
import { fixedClock, loadConfig } from "../sources";

import { applyThemeIcons, runRender } from "./render";

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
