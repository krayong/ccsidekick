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

const base = (over: Partial<DashboardProps> = {}): DashboardProps => ({
	targets: [{ dir: "/home/dev/.claude", scope: "global" }],
	env: { TERM: "xterm-256color" },
	cols: 100,
	rows: 40,
	...over,
});

test("q on a dirty config guards; n backs out; y quits", async () => {
	let quit = 0;
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({
				onQuit: () => {
					quit++;
				},
			}),
		),
	);
	await tick();
	// make the draft dirty: open Theme, focus list, select a theme
	stdin.write("2");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("d");
	await tick();
	stdin.write("j");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("\t");
	await tick(); // back to sidebar so q is a quit request
	stdin.write("q");
	await tick();
	expect(lastFrame() ?? "").toContain("Discard changes?");
	stdin.write("n");
	await tick();
	expect(lastFrame() ?? "").not.toContain("Discard changes?"); // backed out
	expect(quit).toBe(0);
	stdin.write("q");
	await tick();
	stdin.write("y");
	await tick();
	expect(quit).toBe(1);
});

test("initialDirty seeds the dirty flag so a post-switch quit still guards", async () => {
	// A view switch (Ctrl+W/Ctrl+D) remounts the dashboard; initialDirty carries the unsaved state across so
	// pressing q immediately still prompts rather than quitting and dropping the edits.
	let quit = 0;
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ initialDirty: true, onQuit: () => quit++ })),
	);
	await tick();
	expect(lastFrame() ?? "").toContain("● unsaved"); // dirty from the start
	stdin.write("q");
	await tick();
	expect(lastFrame() ?? "").toContain("Discard changes?");
	expect(quit).toBe(0);
});
