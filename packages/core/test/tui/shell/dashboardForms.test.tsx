import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

const onSave = (): void => {
	throw new Error("disk full");
};

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

test("entering the Network section and toggling a field marks the draft dirty", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	expect(lastFrame() ?? "").toContain("✓ saved"); // clean at start
	stdin.write("5"); // jump to Network (section index 4, 1-based key "5")
	await tick();
	stdin.write("\r"); // open the section (sidebar → content)
	await tick();
	const opened = lastFrame() ?? "";
	expect(opened).toContain("FX refresh");
	stdin.write(" "); // toggle the first field
	await tick();
	const after = lastFrame() ?? "";
	expect(after).toContain("● unsaved"); // dirty marker in the header
});

test("Ctrl+S inside a form's content zone opens the save popup instead of moving the cursor", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("5"); // jump to Network
	await tick();
	stdin.write("\r"); // sidebar → content
	await tick();
	stdin.write("\x13"); // Ctrl+S: must not be swallowed as a field-nav "s" (down-move)
	await tick();
	expect(lastFrame() ?? "").toContain("Save & install");
});

test("Ctrl+S runs save with the draft and clears dirty on success", async () => {
	let saved: Config | null = null;
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ onSave: (c) => (saved = c) })),
	);
	await tick();
	stdin.write("5"); // Network
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write(" "); // toggle → dirty
	await tick();
	expect(lastFrame() ?? "").toContain("● unsaved");
	stdin.write("\x13"); // open the save-confirm popup (Ctrl+S)
	await tick();
	stdin.write("y"); // confirm install
	await tick();
	expect(saved).not.toBeNull();
	expect(lastFrame() ?? "").toContain("✓ saved");
});

test("a save failure surfaces an error and keeps the draft dirty", async () => {
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({
				onSave: () => {
					throw new Error("EACCES boom");
				},
			}),
		),
	);
	await tick();
	stdin.write("5");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write(" ");
	await tick();
	stdin.write("\x13"); // open the save-confirm popup (Ctrl+S)
	await tick();
	stdin.write("y"); // confirm install -> throws
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("EACCES boom");
	expect(frame).toContain("● unsaved"); // still dirty
});

test("Character and Stats sections render an empty form region without crashing", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\r"); // open Character (section 0)
	await tick();
	expect(lastFrame() ?? "").toContain("CHARACTER"); // eyebrow renders, no fields, no crash
});

test("a save failure renders an Alert and keeps the draft dirty", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ onSave })));
	await tick();
	stdin.write("5"); // Network
	await tick();
	stdin.write("\r"); // open
	await tick();
	stdin.write(" "); // toggle -> dirty
	await tick();
	stdin.write("\x13"); // open the save-confirm popup (Ctrl+S)
	await tick();
	stdin.write("y"); // confirm install -> throws
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).not.toContain("! disk full"); // the in-house banner is exactly `! {error}`; the Alert formats differently
	expect(frame).toContain("disk full"); // the Alert carries the message
	expect(frame).toContain("● unsaved"); // still dirty
});

test("the Character Roster lists batman with an empty roster", async () => {
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ packs: ["batman"], installed: ["batman"] })),
	);
	await tick();
	stdin.write("1");
	await tick();
	stdin.write("\r");
	await tick();
	expect(lastFrame() ?? "").toContain("batman");
});

test("Statusline rail: entering a widget group and toggling a widget marks the draft dirty", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("6"); // jump to Statusline (section index 5, 1-based key "6")
	await tick();
	stdin.write("\r"); // open the section (sidebar → content); rail starts on the Format category
	await tick();
	stdin.write("s"); // category cursor Format -> Git
	await tick();
	stdin.write("d"); // focus the Git group's list
	await tick();
	const opened = lastFrame() ?? "";
	expect(opened).toContain("git_branch");
	stdin.write("\r"); // toggle git_branch (on by default)
	await tick();
	const after = lastFrame() ?? "";
	expect(after).toContain("● unsaved");
});

test("the Currency picker captures every key while open: / s q type into the query, only esc/↵ close it", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("6"); // jump to Statusline (section index 5, 1-based key "6")
	await tick();
	stdin.write("\r"); // open the section (sidebar → content); rail starts on Format, Currency row
	await tick();
	stdin.write("d"); // drill the rail focus into the list (Format category already selected)
	await tick();
	stdin.write("\r"); // act on the Currency row: opens the currency picker overlay
	await tick();
	const opened = lastFrame() ?? "";
	expect(opened).toContain("Currency");
	expect(opened).toContain("EUR"); // the bundled fallback seeds the list even with no cached fx.json
	stdin.write("/"); // must type into the query, not open Find behind the picker
	await tick();
	stdin.write("s"); // must type into the query, not toggle a widget or open save
	await tick();
	stdin.write("q"); // must type into the query, not quit
	await tick();
	const typing = lastFrame() ?? "";
	expect(typing).toContain("/sq█");
	expect(typing).not.toContain("Find");
	expect(typing).not.toContain("Save & install");
	expect(typing).toContain("Currency"); // still open — q did not quit
	stdin.write("\x7f"); // backspace back to an empty query
	stdin.write("\x7f");
	stdin.write("\x7f");
	await tick();
	stdin.write("e"); // filter down to EUR
	stdin.write("u");
	stdin.write("r");
	await tick();
	const filtered = lastFrame() ?? "";
	expect(filtered).toContain("EUR");
	expect(filtered).not.toContain("GBP");
	stdin.write("\r"); // commit EUR
	await tick();
	const committed = lastFrame() ?? "";
	expect(committed).toContain("Currency: EUR"); // committed via change(), no setCurrency helper
	expect(committed).toContain("● unsaved");
	expect(committed).not.toContain("esc close · ↵ select"); // the picker popup itself is closed
});

test("esc closes the Currency picker without committing", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("6");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("d");
	await tick();
	stdin.write("\r");
	await tick();
	expect(lastFrame() ?? "").toContain("Currency");
	stdin.write("\x1b"); // esc
	await tick();
	const after = lastFrame() ?? "";
	expect(after).not.toContain("esc close · ↵ select");
	expect(after).not.toContain("● unsaved");
});

test("the Currency picker filters on 'j' instead of navigating; arrows still move the cursor", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("6"); // jump to Statusline
	await tick();
	stdin.write("\r"); // open the section; rail starts on Format, Currency row
	await tick();
	stdin.write("d"); // drill the rail focus into the list
	await tick();
	stdin.write("\r"); // open the currency picker (cursor starts at index 0: EUR)
	await tick();

	// Arrow keys still navigate: down twice lands on JPY (EUR, GBP, JPY, ...) and commits it.
	stdin.write("\x1B[B");
	await tick();
	stdin.write("\x1B[B");
	await tick();
	stdin.write("\r");
	await tick();
	expect(lastFrame() ?? "").toContain("Currency: JPY");

	// Reopen (rail focus/itemCursor already point at the Currency row, so a bare enter reopens it).
	stdin.write("\r");
	await tick();
	const opened = lastFrame() ?? "";
	expect(opened).toContain("EUR");
	expect(opened).toContain("JPY");

	stdin.write("j"); // must filter the list, not move the cursor down
	await tick();
	const filtered = lastFrame() ?? "";
	expect(filtered).toContain("j█"); // the "j" keystroke landed in the query
	expect(filtered).toContain("JPY"); // JPY is the only fallback code containing "j"
	expect(filtered).not.toContain("EUR"); // filtered out, not just scrolled past
	stdin.write("\r"); // commit the sole match
	await tick();
	expect(lastFrame() ?? "").toContain("Currency: JPY");
});

test("Save section: space flips the project target's scope, and the header chip tracks it", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "ccsk-dash-home-"));
	mkdirSync(join(homeDir, "ccsidekick"));
	writeFileSync(join(homeDir, "ccsidekick", "config.toml"), "");
	const projDir = mkdtempSync(join(tmpdir(), "ccsk-dash-proj-"));
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({
				targets: [
					{ dir: homeDir, scope: "global" },
					{ dir: join(projDir, ".claude"), scope: "local", cwd: projDir },
				],
			}),
		),
	);
	await tick();
	stdin.write("8"); // jump to Save (section index 7, 1-based key "8")
	await tick();
	expect(lastFrame() ?? "").toContain("[mixed]"); // one global home + one local project
	stdin.write(" "); // toggle the project target's scope
	await tick();
	const after = lastFrame() ?? "";
	expect(after).toContain("[global]"); // both targets now global
	expect(after).toContain("● unsaved");
	stdin.write("\r"); // Enter must still open the save-confirm, not be swallowed by the toggle
	await tick();
	expect(lastFrame() ?? "").toContain("Save & install");
});

test("seeds the draft from <configDir>/ccsidekick/config.toml when no initialConfig is given", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-dash-seed-"));
	mkdirSync(join(dir, "ccsidekick"));
	writeFileSync(join(dir, "ccsidekick", "config.toml"), '[line]\ncurrency = "JPY"\n');
	const props: DashboardProps = {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		// no initialConfig — disk seed path is exercised
	};
	const { lastFrame, stdin } = render(createElement(Dashboard, props));
	await tick();
	stdin.write("6"); // jump to Statusline section (section index 5, 1-based key "6")
	await tick();
	stdin.write("\r"); // open the section (sidebar → content)
	await tick();
	expect(lastFrame() ?? "").toContain("JPY");
});
