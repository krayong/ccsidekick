import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { type DashboardProps, Dashboard } from "../../../src/tui/shell";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const tick = async (): Promise<void> => new Promise((r) => setTimeout(r, 25));
const TAB = "\t";
const DOWN = "[B";

const base = (over: Partial<DashboardProps> = {}): DashboardProps => ({
	targets: [{ dir: "/home/dev/.claude", scope: "global" }],
	env: { TERM: "xterm-256color" },
	cols: 100,
	rows: 40,
	...over,
});

test("a below-floor size shows the Terminal-too-small popup with the current size", () => {
	const frame = render(createElement(Dashboard, base({ cols: 50, rows: 20 }))).lastFrame() ?? "";
	expect(frame.toLowerCase()).toContain("terminal too small");
	expect(frame).toContain("80"); // the required minimum
	expect(frame).toContain("24");
	expect(frame).toContain("50x20"); // the live size, proving the size math ran
	expect(frame).toContain("╭"); // now a bordered popup
});

test("Tab moves focus from the sidebar into the content region", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	const before = lastFrame() ?? "";
	expect(before).toContain("❯ Character"); // sidebar has the marker
	stdin.write(TAB);
	await tick();
	const after = lastFrame() ?? "";
	expect(after).not.toBe(before);
	expect(after).not.toContain("❯ Character"); // marker leaves the sidebar when content is focused
});

test("arrow keys in the sidebar change the highlighted section", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write(DOWN);
	await tick();
	expect(lastFrame() ?? "").toContain("❯ Theme");
});

test("q on a clean dashboard quits immediately", async () => {
	let quit = false;
	const { stdin } = render(createElement(Dashboard, base({ onQuit: () => (quit = true) })));
	await tick();
	stdin.write("q");
	await tick();
	expect(quit).toBe(true);
});

test("q with unsaved edits opens the guard, then n backs out and y quits", async () => {
	let quit = false;
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ onQuit: () => (quit = true) })),
	);
	await tick();
	// Make an edit so `dirty` flips true: drill into Character, focus the list, and toggle the selection.
	stdin.write(TAB);
	await tick();
	stdin.write("d"); // focus the pack list
	await tick();
	stdin.write(" "); // act: toggle the first pack's selection
	await tick();
	stdin.write(TAB);
	await tick();
	stdin.write("q");
	await tick();
	expect(lastFrame() ?? "").toContain("Discard changes?");
	expect(quit).toBe(false);
	stdin.write("n");
	await tick();
	expect(lastFrame() ?? "").not.toContain("Discard changes?"); // backed out, still editing
	expect(quit).toBe(false);
	stdin.write("q");
	await tick();
	stdin.write("y");
	await tick();
	expect(quit).toBe(true);
});

test("Ctrl+S opens the save-confirm popup; y installs to every configured dir", async () => {
	const calls: string[] = [];
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({
				targets: [
					{ dir: "/a/.claude", scope: "global" },
					{ dir: "/b/.claude", scope: "global" },
				],
				onSave: (_c, target) => {
					calls.push(target.dir);
				},
			}),
		),
	);
	await tick();
	stdin.write("\x13"); // the save/install shortcut (Ctrl+S)
	await tick();
	expect(lastFrame() ?? "").toContain("Save & install");
	expect(calls).toEqual([]); // nothing written yet
	stdin.write("y");
	await tick();
	expect(calls).toEqual(["/a/.claude", "/b/.claude"]);
});
