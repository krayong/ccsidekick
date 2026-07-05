// Direct coverage of the live ConfigDirPicker widget (reused by the Welcome screen): the discovered dirs, the
// "· suggested" tag starting checked, the cursor starting at row 0, toggling checkboxes, the "Custom path…" row,
// and confirming checked dirs. Previously this behavior was only exercised through the old monolith App.

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { ConfigDirPicker } from "../../../src/tui/sections";
import type { SaveTarget } from "../../../src/tui/shell";

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

const g = (dir: string): SaveTarget => ({ dir, scope: "global" });

test("the picker lists dirs, tags the suggested one, and starts it checked", () => {
	// Short static paths keep every row on one line so the "· suggested" tag stays contiguous in the frame.
	const frame =
		render(
			createElement(ConfigDirPicker, {
				dirs: [g("/h/.claude"), g("/h/.claude-personal")],
				suggested: "/h/.claude-personal",
				suggestedIndex: 1,
				onChosen: () => {},
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("CLAUDE CONFIG DIR");
	expect(frame).toContain(".claude-personal");
	expect(frame).toContain("Custom path…");
	expect(frame).toContain("· suggested"); // the suggested dir is tagged
	expect(frame).toMatch(/\[x\] .*\.claude-personal/); // the suggested dir starts checked
	expect(frame).toMatch(/▸ \[ \] \/h\/\.claude\b/); // cursor starts on the first row, unchecked
});

test("Enter confirms the checked dir via onChosen", async () => {
	const home = mkdtempSync(join(tmpdir(), "ccsk-pick-"));
	const suggested = join(home, ".claude-personal");
	mkdirSync(suggested); // existsSync must pass so the pick confirms immediately (no create prompt)
	const chosen: (readonly SaveTarget[])[] = [];
	const { stdin } = render(
		createElement(ConfigDirPicker, {
			dirs: [g(join(home, ".claude")), g(suggested)],
			suggested,
			suggestedIndex: 1,
			onChosen: (targets) => {
				chosen.push([...targets]);
			},
		}),
	);
	await tick(); // let raw mode settle
	stdin.write("\r"); // enter confirms the checked (suggested) dir
	await tick();
	expect(chosen).toEqual([[g(suggested)]]);
});

test("`a` selects all and Enter configures every checked dir", async () => {
	const chosen: (readonly SaveTarget[])[] = [];
	const { stdin } = render(
		createElement(ConfigDirPicker, {
			dirs: [g("/h/.claude"), g("/h/.claude-work")],
			suggested: "/h/.claude",
			suggestedIndex: 0,
			onChosen: (targets) => {
				chosen.push([...targets]);
			},
		}),
	);
	await tick();
	stdin.write("a"); // select all
	await tick();
	stdin.write("\r"); // confirm
	await tick();
	expect(chosen).toEqual([[g("/h/.claude"), g("/h/.claude-work")]]);
});

test("the project row is tagged as a local target, and picking it yields its cwd", async () => {
	const home = mkdtempSync(join(tmpdir(), "ccsk-pick-"));
	const cwd = mkdtempSync(join(tmpdir(), "ccsk-proj-"));
	const project: SaveTarget = {
		dir: join(cwd, ".claude"),
		scope: "local",
		cwd,
		wireLocalSettings: true,
	};
	const frame =
		render(
			createElement(ConfigDirPicker, {
				dirs: [g(join(home, ".claude")), project],
				suggestedIndex: 0,
				onChosen: () => {},
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("this project");
	expect(frame).toContain("local");

	const chosen: (readonly SaveTarget[])[] = [];
	const { stdin } = render(
		createElement(ConfigDirPicker, {
			dirs: [g(join(home, ".claude")), project],
			suggestedIndex: 0,
			onChosen: (targets) => {
				chosen.push([...targets]);
			},
		}),
	);
	await tick();
	stdin.write(" "); // toggle off the preselected home dir (cursor starts on row 0)
	await tick();
	stdin.write("\x1B[B"); // down to the project row
	await tick();
	stdin.write(" "); // check the project row
	await tick();
	stdin.write("\r");
	await tick();
	expect(chosen).toEqual([[project]]);
	expect(chosen[0]?.[0]?.cwd).toBe(cwd);
});
