import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { type Config, DEFAULT_CONFIG } from "../../../src/sources";
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

function base(over: Partial<DashboardProps> = {}): DashboardProps {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-mode-"));
	return {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		initialConfig: DEFAULT_CONFIG,
		packs: ["batman"],
		...over,
	};
}

test("selecting fixed on the Mode category sets the mode and marks dirty", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content (Mode category, category column focused)
	await tick();
	stdin.write("d"); // focus the Mode list (cursor at index 0 = "fixed")
	await tick();
	expect(lastFrame() ?? "").toContain("● random"); // random is the default, marked active
	stdin.write("\r"); // select "fixed" (the row under the cursor)
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("● fixed");
	expect(frame).toContain("● unsaved");
});

test("switching Mode to fixed never clobbers the seeded name or roster", async () => {
	let saved: Config | null = null;
	const initialConfig = {
		...DEFAULT_CONFIG,
		character: {
			...DEFAULT_CONFIG.character,
			mode: "random" as const,
			name: "batman",
			roster: ["robin"],
		},
	};
	const { stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin"], initialConfig, onSave: (c) => (saved = c) }),
		),
	);
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content (Mode category)
	await tick();
	stdin.write("d"); // focus the Mode list (cursor 0 = fixed)
	await tick();
	stdin.write("\r"); // select fixed
	await tick();
	stdin.write("\x13"); // Ctrl+S: open the save-confirm
	await tick();
	stdin.write("y"); // confirm
	await tick();
	// mode changed, but the seeded name and roster are untouched.
	expect(saved!.character.mode).toBe("fixed");
	expect(saved!.character.name).toBe("batman");
	expect(saved!.character.roster).toEqual(["robin"]);
});
