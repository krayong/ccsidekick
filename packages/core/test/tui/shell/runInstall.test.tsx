// The guard for the whole per-target save mechanism: every other dashboard test injects an `onSave` spy that
// short-circuits before the real `save()` write, so the local branch (writeConfigToml + the conditional
// settings.json wire) was otherwise untested. This mounts the Dashboard with no `onSave` and drives the real
// disk write through Ctrl+S -> y.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const base = (over: Partial<DashboardProps>, cwd: string): DashboardProps => ({
	targets: [{ dir: join(cwd, ".claude"), scope: "local", cwd, wireLocalSettings: true }],
	env: { TERM: "xterm-256color" },
	cols: 100,
	rows: 40,
	...over,
});

const install = async (props: DashboardProps): Promise<void> => {
	const { stdin } = render(createElement(Dashboard, props));
	await tick();
	stdin.write("\x13"); // Ctrl+S: open the save-confirm popup
	await tick();
	stdin.write("y"); // confirm install
	await tick();
};

test("a local target with wireLocalSettings writes config.toml and wires settings.json", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "ccsk-runinstall-"));
	await install(base({}, cwd));
	expect(existsSync(join(cwd, ".ccsidekick", "config.toml"))).toBe(true);
	expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(true);
});

test("a local target with wireLocalSettings: false writes config.toml but never touches settings.json", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "ccsk-runinstall-"));
	await install(
		base(
			{
				targets: [
					{ dir: join(cwd, ".claude"), scope: "local", cwd, wireLocalSettings: false },
				],
			},
			cwd,
		),
	);
	expect(existsSync(join(cwd, ".ccsidekick", "config.toml"))).toBe(true);
	expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
});
