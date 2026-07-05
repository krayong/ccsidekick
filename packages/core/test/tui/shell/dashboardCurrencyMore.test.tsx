import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
	const dir = mkdtempSync(join(tmpdir(), "ccsk-dash-"));
	mkdirSync(join(dir, "ccsidekick"));
	writeFileSync(join(dir, "ccsidekick", "config.toml"), "");
	return {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		initialConfig: DEFAULT_CONFIG,
		...over,
	};
}

test("the currency picker shows a ▾ N more hint inside the popup", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ rows: 24 })));
	await tick();
	stdin.write("6"); // jump to Statusline (section index 5, 1-based key "6")
	await tick();
	stdin.write("\r"); // open the section (sidebar -> content); rail starts on Format, Currency row
	await tick();
	stdin.write("d"); // drill the rail focus into the list
	await tick();
	stdin.write("\r"); // act on the Currency row: opens the currency picker overlay
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("more"); // ~40 fallback codes, windowed at the shrunk terminal height
	expect(frame).toContain("▾");
});
