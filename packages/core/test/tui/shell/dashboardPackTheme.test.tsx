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
	const dir = mkdtempSync(join(tmpdir(), "ccsk-pack-theme-"));
	return {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		initialConfig: DEFAULT_CONFIG,
		...over,
	};
}

const installedWithThemes = { packs: ["batman", "spiderman"], installed: ["batman", "spiderman"] };

// Each keystroke on the Themes list recomputes the mini-statusline preview via a real (disk-backed)
// scenario render, so walking down past the ~70-entry built-in catalog to reach the pack themes at
// the tail is slow (not a hang) -- these two tests get a generous timeout to cover that walk.
const NAV_TIMEOUT_MS = 30000;

test(
	"installed packs with a theme block appear in the Theme list",
	async () => {
		const { lastFrame, stdin } = render(createElement(Dashboard, base(installedWithThemes)));
		await tick();
		stdin.write("2"); // Theme
		await tick();
		stdin.write("\r"); // open content
		await tick();
		stdin.write("d"); // focus the Themes list
		await tick();
		// Pack themes register after the (windowed) built-in catalog, so scroll to the tail to bring
		// "Spider-Man" into the visible window.
		for (let i = 0; i < 80; i++) {
			stdin.write("j");
			await tick();
			if ((lastFrame() ?? "").includes("Spider-Man")) break;
		}
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Spider-Man"); // pack theme registered under the pack name
	},
	NAV_TIMEOUT_MS,
);

// Collect the truecolor sequences the Character figure emits under a given theme.
const figureColors = (frame: string): Set<string> =>
	new Set(frame.match(/38;2;\d+;\d+;\d+/g) ?? []);

test(
	"selecting a pack theme recolors the character figure",
	async () => {
		const { lastFrame, stdin } = render(createElement(Dashboard, base(installedWithThemes)));
		await tick();
		stdin.write("1");
		await tick();
		stdin.write("\r");
		await tick(); // Character (houston)
		const houston = figureColors(lastFrame() ?? "");
		stdin.write("2");
		await tick();
		stdin.write("\r");
		await tick();
		stdin.write("d");
		await tick();
		// step down to the "batman" pack theme (it registers after the built-ins); walk with j until
		// the detail shows Batman
		for (let i = 0; i < 80; i++) {
			stdin.write("j");
			await tick();
			if ((lastFrame() ?? "").includes("Batman")) break;
		}
		stdin.write("\r");
		await tick(); // apply batman theme
		stdin.write("1");
		await tick();
		stdin.write("\r");
		await tick(); // back to Character
		const batman = figureColors(lastFrame() ?? "");
		expect([...batman].some((c) => !houston.has(c))).toBe(true);
	},
	NAV_TIMEOUT_MS,
);
