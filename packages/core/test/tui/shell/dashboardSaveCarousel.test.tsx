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

// A two-character random roster so the carousel has something to page through.
const rosterConfig = {
	...DEFAULT_CONFIG,
	character: {
		...DEFAULT_CONFIG.character,
		mode: "random" as const,
		roster: ["batman", "robin"],
	},
};

function base(over: Partial<DashboardProps> = {}): DashboardProps {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-save-carousel-"));
	return {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		initialConfig: rosterConfig,
		packs: ["batman", "robin"],
		...over,
	};
}

test("the save-confirm carousel pages through the selected characters and wraps", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x13"); // Ctrl+S opens the save-confirm
	await tick();
	const first = lastFrame() ?? "";
	expect(first).toContain("Save & install");
	expect(first).toContain("1/2 characters");
	expect(first).toContain("batman");

	stdin.write("\x1b[C"); // right arrow: next character (ijkl now scrolls the preview)
	await tick();
	const second = lastFrame() ?? "";
	expect(second).toContain("2/2 characters");
	expect(second).toContain("robin");

	stdin.write("\x1b[C"); // wraps back to the first
	await tick();
	expect(lastFrame() ?? "").toContain("1/2 characters");
});
