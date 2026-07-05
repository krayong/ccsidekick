// packages/core/test/tui/shell/dashboardOverlays.test.tsx
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
	const dir = mkdtempSync(join(tmpdir(), "ccsk-ovl-"));
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

test("? opens the help popup and Esc closes it", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("?");
	await tick();
	let frame = lastFrame() ?? "";
	expect(frame).toContain("Help");
	expect(frame).toContain("╭"); // bordered popup
	expect(frame.toLowerCase()).toContain("esc close");
	stdin.write("\x1b"); // Escape
	await tick();
	frame = lastFrame() ?? "";
	expect(frame.toLowerCase()).not.toContain("esc close");
});

test("/ opens the Find popup and typing filters the global ranked list to a section", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("/"); // open Find from the sidebar
	await tick();
	stdin.write("t");
	await tick();
	stdin.write("h");
	await tick();
	stdin.write("e");
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Find");
	expect(frame).toContain("/the");
	expect(frame).toContain("Theme");
});

test("Enter jumps to the highlighted section and closes Find", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("/");
	await tick();
	stdin.write("t");
	await tick();
	stdin.write("h");
	await tick();
	stdin.write("e");
	await tick();
	stdin.write("\r"); // jump to the top-ranked match (Theme)
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).not.toContain("Find"); // popup closed
	expect(frame).toContain("THEME"); // AppShell's content eyebrow uppercases the active section name
});

test("typing filters to a form-section field and Enter jumps the form cursor to it", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("/");
	await tick();
	// "comm" uniquely matches the Voice section's "Comments" field (no other label contains it).
	for (const ch of ["c", "o", "m", "m"]) {
		stdin.write(ch);
		await tick();
	}
	let frame = lastFrame() ?? "";
	expect(frame).toContain("Voice › Comments");
	stdin.write("\r"); // jump to the field
	await tick();
	frame = lastFrame() ?? "";
	expect(frame).not.toContain("Find"); // popup closed
	const line = frame.split("\n").find((l) => l.includes("Comments")) ?? "";
	expect(line).toContain("❯"); // the form cursor landed on the picked field
});

test("s and q while Find is open type into the query instead of firing install/quit", async () => {
	let quit = false;
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ onQuit: () => (quit = true) })),
	);
	await tick();
	stdin.write("/");
	await tick();
	stdin.write("s"); // both are printable while Find is open
	await tick();
	stdin.write("q");
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("/sq"); // captured into the query, not fired as global shortcuts
	expect(frame).toContain("Find"); // the popup is still open; q did not close/quit it
	expect(quit).toBe(false); // the process is still alive
});

test("picking the Find install entry opens the save-confirm popup instead of writing to disk", async () => {
	const calls: string[] = [];
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({
				onSave: (_c, target) => {
					calls.push(target.dir);
				},
			}),
		),
	);
	await tick();
	stdin.write("/");
	await tick();
	for (const ch of ["i", "n", "s", "t", "a", "l", "l"]) {
		stdin.write(ch);
		await tick();
	}
	stdin.write("\r"); // pick the install entry
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Save & install"); // the save-confirm popup opened
	expect(calls).toEqual([]); // nothing written without explicit y/Enter confirmation
});

test("reopening the save-confirm popup after a failed save does not show the stale error", async () => {
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({
				onSave: () => {
					throw new Error("disk is full");
				},
			}),
		),
	);
	await tick();
	stdin.write("\x13"); // Ctrl+S opens save-confirm
	await tick();
	stdin.write("y"); // the save fails, leaving the popup open with the error banner
	await tick();
	let frame = lastFrame() ?? "";
	expect(frame).toContain("disk is full");
	stdin.write("\x1b"); // Escape closes the popup, error still set
	await tick();
	stdin.write("\x13"); // reopen the save-confirm
	await tick();
	frame = lastFrame() ?? "";
	expect(frame).toContain("Save & install");
	expect(frame).not.toContain("disk is full");
});

test("esc closes Find without jumping anywhere", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("/");
	await tick();
	stdin.write("t");
	await tick();
	let frame = lastFrame() ?? "";
	expect(frame).toContain("Find");
	stdin.write("\x1b"); // Escape
	await tick();
	frame = lastFrame() ?? "";
	expect(frame).not.toContain("Find");
	expect(frame).toContain("❯ Character"); // back to the initial sidebar state, section unchanged
});
