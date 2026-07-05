import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { createElement, type ReactElement, useEffect } from "react";

import { App, type AppProps, useShimmerNow } from "../../../src/tui/shell";

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
const wait = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Reduced motion in tests → no shimmer interval re-rendering under the input, so timing stays deterministic.
function base(over: Partial<AppProps> = {}): AppProps {
	return {
		env: { TERM: "xterm-256color", CCSIDEKICK_REDUCE_MOTION: "1" },
		cols: 100,
		rows: 40,
		...over,
	};
}

test("with a configDir the shell opens the dashboard directly (no welcome)", () => {
	const frame =
		render(createElement(App, base({ configDir: "/home/dev/.claude" }))).lastFrame() ?? "";
	expect(frame).toContain("Character"); // the sidebar section list — the dashboard
	expect(frame).not.toContain("█"); // no welcome wordmark
});

test("with no configDir the Welcome shows and a selection advances to the dashboard", async () => {
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
	expect(frame).toContain("Character"); // dashboard sidebar
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
	expect(after).toContain("Character"); // dashboard sidebar, now on the project's local target
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

test("useShimmerNow stops ticking once active goes false", async () => {
	// A probe that renders the current shimmer value and lets the test flip `active`.
	let ticks = 0;

	function Probe({ active }: { readonly active: boolean }): ReactElement {
		const now = useShimmerNow(false, active); // motion allowed
		useEffect(() => {
			ticks += 1;
		}, [now]);
		return createElement(Text, null, String(now));
	}

	const { rerender, unmount } = render(createElement(Probe, { active: true }));
	await wait(300); // several 120ms intervals elapse → the clock has ticked
	const whileActive = ticks;
	expect(whileActive).toBeGreaterThan(1);
	rerender(createElement(Probe, { active: false })); // dashboard is now active → clear the interval
	await wait(300);
	expect(ticks).toBe(whileActive); // no further ticks after active went false
	unmount();
});
