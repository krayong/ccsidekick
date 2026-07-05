import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { DEFAULT_CONFIG } from "../../../src/sources";
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
		installed: ["batman"],
		...over,
	};
}

test("Enter on the Mode row cycles random -> fixed and marks dirty", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content (category column focused)
	await tick();
	stdin.write("d"); // focus the list column (cursor on the Mode row, index 0)
	await tick();
	expect(lastFrame() ?? "").toContain("random");
	stdin.write("\r"); // cycle mode
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("fixed");
	expect(frame).toContain("● unsaved");
});

test("switching category Roster -> Browse -> Roster remaps the item cursor onto the corresponding pack, not the Mode row", async () => {
	// Roster's Mode row shifts every pack down by one relative to Browse. Round-tripping the category
	// cursor must land back on the first pack (index 1 on Roster), not on the Mode row (index 0) — an
	// unmapped implementation would leave the cursor at 0 after the Browse -> Roster switch.
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin"], installed: ["batman", "robin"] }),
		),
	);
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content
	await tick();
	stdin.write("s"); // category Roster -> Browse
	await tick();
	stdin.write("w"); // category Browse -> Roster
	await tick();
	stdin.write("d"); // focus the list column (cursor should now be on batman, not the Mode row)
	await tick();
	stdin.write("\r"); // activate: must select batman, not cycle Mode
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("● batman"); // batman toggled into the roster
	expect(frame).not.toContain("fixed"); // Mode was left alone (still random)
});

test("cycling Mode fixed<->random never clobbers the other field (name vs roster)", async () => {
	const initialConfig = {
		...DEFAULT_CONFIG,
		character: {
			...DEFAULT_CONFIG.character,
			mode: "random" as const,
			name: "batman",
			roster: ["robin"],
		},
	};
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin"], installed: ["batman", "robin"], initialConfig }),
		),
	);
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content
	await tick();
	stdin.write("d"); // focus the list column (cursor on the Mode row)
	await tick();
	// random: the seeded roster ["robin"] is active.
	expect(lastFrame() ?? "").toContain("● robin");
	stdin.write("\r"); // cycle random -> fixed
	await tick();
	// fixed: the seeded name "batman" becomes active; roster is untouched underneath.
	expect(lastFrame() ?? "").toContain("● batman");
	stdin.write("\r"); // cycle fixed -> random
	await tick();
	// random again: the original roster ["robin"] must still be intact, not cleared by the fixed cycle.
	expect(lastFrame() ?? "").toContain("● robin");
});
