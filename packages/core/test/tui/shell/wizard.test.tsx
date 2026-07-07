import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import type { Config } from "../../../src/sources";
import { Wizard, type SaveTarget, type WizardProps } from "../../../src/tui/shell";

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
const target: SaveTarget = { dir: "/tmp/x", scope: "global" };

function base(over: Partial<WizardProps> = {}): WizardProps {
	return {
		targets: [target],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		...over,
	};
}

test("the wizard opens on the Character step with the stepper", () => {
	const frame = render(createElement(Wizard, base())).lastFrame() ?? "";
	expect(frame).toContain("ccsidekick setup");
	expect(frame).toContain("Step 1 of 4");
	expect(frame).toContain("Roster"); // the CharacterSection is the step body
});

test("Tab walks Character -> Theme -> Comments -> Review", async () => {
	const { lastFrame, stdin } = render(createElement(Wizard, base()));
	await tick();
	stdin.write("\t");
	await tick();
	expect(lastFrame() ?? "").toContain("Step 2 of 4");
	expect(lastFrame() ?? "").toContain("Match Character"); // theme list
	stdin.write("\t");
	await tick();
	expect(lastFrame() ?? "").toContain("Step 3 of 4");
	expect(lastFrame() ?? "").toContain("Character Comments"); // comments form
	stdin.write("\t");
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Step 4 of 4");
	expect(frame).toContain("Review");
	expect(frame).toContain("Press ↵ to save");
});

test("Enter on the Review step saves the draft for every target", async () => {
	let saved: Config | null = null;
	let savedTarget: SaveTarget | null = null;
	const { lastFrame, stdin } = render(
		createElement(
			Wizard,
			base({
				onSave: (c, t) => {
					saved = c;
					savedTarget = t;
				},
			}),
		),
	);
	await tick();
	stdin.write("\t"); // Theme
	stdin.write("\t"); // Comments
	stdin.write("\t"); // Review
	await tick();
	stdin.write("\r"); // save
	await tick();
	expect(saved).not.toBeNull();
	expect(savedTarget!).toEqual(target);
	expect((lastFrame() ?? "").toLowerCase()).toContain("set up"); // the done screen
});

test("selecting a theme on step 2 lands in the saved config", async () => {
	let saved: Config | null = null;
	const { stdin } = render(createElement(Wizard, base({ onSave: (c) => (saved = c) })));
	await tick();
	stdin.write("\t"); // Theme step (cursor 0 = Match Character)
	await tick();
	stdin.write("s"); // down to the first built-in theme
	await tick();
	stdin.write("\r"); // select it
	await tick();
	stdin.write("\t"); // Comments
	stdin.write("\t"); // Review
	await tick();
	stdin.write("\r"); // save
	await tick();
	expect(saved).not.toBeNull();
	expect(saved!.theme.name).not.toBe("character"); // no longer the default sentinel
});

test("Ctrl+D leaves the wizard for the dashboard, carrying the draft", async () => {
	let advanced: Config | null = null;
	const { stdin } = render(createElement(Wizard, base({ onAdvanced: (d) => (advanced = d) })));
	await tick();
	stdin.write("\x04"); // Ctrl+D
	await tick();
	expect(advanced).not.toBeNull();
});

test("with carried unsaved edits, Esc returns to the dashboard instead of quitting", async () => {
	let advanced: Config | null = null;
	let quit = false;
	const { stdin } = render(
		createElement(
			Wizard,
			base({
				initialDirty: true,
				onAdvanced: (d) => (advanced = d),
				onQuit: () => (quit = true),
			}),
		),
	);
	await tick();
	stdin.write("\x1b"); // Esc
	await tick();
	expect(advanced).not.toBeNull(); // returned to the dashboard with the draft
	expect(quit).toBe(false); // did not quit / discard
});

test("a fresh wizard (no carried edits) quits on Esc", async () => {
	let quit = false;
	const { stdin } = render(createElement(Wizard, base({ onQuit: () => (quit = true) })));
	await tick();
	stdin.write("\x1b"); // Esc
	await tick();
	expect(quit).toBe(true);
});
