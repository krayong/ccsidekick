import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { createElement } from "react";

import { App, type AppProps } from "../../../src/tui/shell";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const tick = async (): Promise<void> => new Promise((r) => setTimeout(r, 25));

function base(over: Partial<AppProps> = {}): AppProps {
	return {
		env: { TERM: "xterm-256color", CCSIDEKICK_REDUCE_MOTION: "1" },
		cols: 100,
		rows: 40,
		...over,
	};
}

test("a preset configDir with no config opens the first-run wizard (no welcome)", () => {
	const frame =
		render(createElement(App, base({ configDir: "/home/dev/.claude" }))).lastFrame() ?? "";
	expect(frame).toContain("ccsidekick setup"); // the wizard header
	expect(frame).toContain("Step 1 of 4"); // the stepper
	expect(frame).not.toContain("█"); // no welcome wordmark
});

test("a preset configDir with an existing config opens the dashboard, not the wizard", () => {
	const dir = track(mkdtempSync(join(tmpdir(), "ccsk-cfg-")));
	mkdirSync(join(dir, "ccsidekick"), { recursive: true });
	writeFileSync(join(dir, "ccsidekick", "config.toml"), ""); // an existing config -> returning user

	const frame = render(createElement(App, base({ configDir: dir }))).lastFrame() ?? "";
	expect(frame).toContain("Statistics"); // a dashboard-only sidebar section
	expect(frame).not.toContain("Step 1 of 4"); // not the wizard
});

test("with no configDir the Welcome shows and a selection advances to the wizard", async () => {
	const home = track(mkdtempSync(join(tmpdir(), "ccsk-home-")));
	const claude = join(home, ".claude");
	mkdirSync(claude, { recursive: true });
	writeFileSync(join(claude, "settings.json"), "{}"); // so discoverConfigDirs lists it

	const { lastFrame, stdin } = render(
		createElement(App, base({ homeDir: home, suggestedDir: claude })),
	);
	await tick();
	expect(lastFrame() ?? "").toContain("█"); // the welcome wordmark
	stdin.write("\r"); // pick the preselected (suggested) dir
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).not.toContain("█"); // welcome gone
	expect(frame).toContain("ccsidekick setup"); // the fresh dir has no config -> the wizard
});

test("the current project is offered as a selectable local target", async () => {
	const home = track(mkdtempSync(join(tmpdir(), "ccsk-home-")));
	const claude = join(home, ".claude");
	mkdirSync(claude, { recursive: true });
	writeFileSync(join(claude, "settings.json"), "{}"); // so discoverConfigDirs lists it

	const cwd = track(mkdtempSync(join(tmpdir(), "ccsk-cwd-")));

	const { lastFrame, stdin } = render(
		createElement(App, base({ homeDir: home, suggestedDir: claude, cwd })),
	);
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("this project"); // the project row is scope-tagged
	expect(frame).toContain("local");

	stdin.write(" "); // uncheck the preselected home dir (cursor starts on row 0)
	await tick();
	stdin.write("\x1B[B"); // down to the project row
	await tick();
	stdin.write(" "); // check the project row
	await tick();
	stdin.write("\r"); // confirm
	await tick();
	const after = lastFrame() ?? "";
	expect(after).not.toContain("█"); // welcome gone
	expect(after).toContain("ccsidekick setup"); // fresh project target -> the wizard
});

test("launching from the home dir suppresses the redundant project row", async () => {
	// cwd === home means the project's target (`<cwd>/.claude`) is the very same dir as the
	// already-listed home target (`~/.claude`). Without dedupe there would be two options (the
	// home dir plus the project), forcing the full picker to show that dir twice; deduped, only
	// one option remains, so the Welcome takes its single-dir shortcut instead of the picker.
	const home = track(mkdtempSync(join(tmpdir(), "ccsk-home-")));
	const claude = join(home, ".claude");
	mkdirSync(claude, { recursive: true });
	writeFileSync(join(claude, "settings.json"), "{}"); // so discoverConfigDirs lists it

	const { lastFrame } = render(
		createElement(App, base({ homeDir: home, suggestedDir: claude, cwd: home })),
	);
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Press ↵ to set up"); // the single-dir shortcut, not the picker
	expect(frame).not.toContain("this project"); // no separate local project row
	expect(frame).not.toContain("CLAUDE CONFIG DIR"); // the picker's checklist never renders
});
