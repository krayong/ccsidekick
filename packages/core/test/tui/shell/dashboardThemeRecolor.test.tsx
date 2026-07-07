import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { displayWidth } from "../../../src";
import { PACKS } from "../../../src/packs";
import { DEFAULT_CONFIG } from "../../../src/sources";
import { renderScenario, SCENARIOS } from "../../../src/tui/preview";
import { Dashboard, type DashboardProps } from "../../../src/tui/shell";

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
	const dir = mkdtempSync(join(tmpdir(), "ccsk-recolor-"));
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

// Collect the truecolor sequences the Character figure emits under a given theme.
const figureColors = (frame: string): Set<string> =>
	new Set(frame.match(/38;2;\d+;\d+;\d+/g) ?? []);

test("selecting a different theme recolors the character figure", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1");
	await tick(); // Character
	stdin.write("\r");
	await tick(); // open (houston figure)
	const houston = figureColors(lastFrame() ?? "");
	stdin.write("2");
	await tick(); // Theme
	stdin.write("\r");
	await tick();
	stdin.write("d");
	await tick(); // focus the Themes list
	stdin.write("j");
	await tick(); // move to dracula (second built-in)
	stdin.write("\r");
	await tick(); // apply
	stdin.write("1");
	await tick(); // back to Character
	stdin.write("\r");
	await tick();
	const dracula = figureColors(lastFrame() ?? "");
	// A non-empty, different palette proves the figure follows the active theme, not the fixed prop.
	expect(dracula.size).toBeGreaterThan(0);
	expect([...dracula].some((c) => !houston.has(c))).toBe(true);
});

test("the theme detail's mini-statusline does not wrap onto an orphaned continuation line", async () => {
	// A too-generous detail-column budget lets the render pipeline's own truncation land a line wider
	// than the Rail's real column, so Ink has to wrap it a second time -- the wrapped remainder shows up
	// as a stray fragment on the next line, under nothing in the category/items columns. At 100 cols
	// (ink-testing-library's own fixed terminal width) the detail body is narrow enough to get dropped
	// entirely by its own no-overflow gate, so this needs a wider `cols` to actually exercise the bug.
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ cols: 160 })));
	await tick();
	stdin.write("2"); // Theme
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("d"); // focus the Themes list (Houston, index 0, is already selected)
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).not.toMatch(/`ANTHROP/);
});

test("the render pipeline honors the real detail-column budget for every pack's chip", () => {
	// shell chrome 27 + Rail chrome 46. A long pack name widens the dropped-figure `[name]` chip, so every
	// character must still fit the pane, not just whichever one a random pick happens to land on.
	const columns = 120;
	const detailWidth = columns - 73;
	const scenario = SCENARIOS[0]!;
	const overflow: string[] = [];
	for (const name of PACKS) {
		const draft = {
			...DEFAULT_CONFIG,
			character: { ...DEFAULT_CONFIG.character, mode: "fixed" as const, name },
		};
		const out = renderScenario(scenario, draft, { columns: detailWidth, noColor: true });
		for (const line of out.split("\n")) {
			if (displayWidth(line) > detailWidth)
				overflow.push(`${name} (${displayWidth(line)}): ${JSON.stringify(line)}`);
		}
	}
	expect(overflow).toEqual([]);
});
