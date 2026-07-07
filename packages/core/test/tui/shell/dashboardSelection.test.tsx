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
	const dir = mkdtempSync(join(tmpdir(), "ccsk-sel-"));
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

test("the Character section opens on the Mode category; the Roster category lists the packs", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content (Mode category selected)
	await tick();
	const opened = lastFrame() ?? "";
	expect(opened).toContain("Mode");
	expect(opened).toContain("Roster");
	expect(opened).not.toContain("Browse");
	stdin.write("s"); // category cursor Mode -> Roster
	await tick();
	expect(lastFrame() ?? "").toContain("batman");
});

test("selecting a theme sets the draft theme and marks it dirty", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("2"); // Theme
	await tick();
	stdin.write("\r"); // open content
	await tick();
	expect(lastFrame() ?? "").toContain("Houston"); // ThemeSection renders theme display names; FormSection never would
	stdin.write("d"); // focus the Themes list
	await tick();
	stdin.write("j"); // itemCursor -> second theme
	await tick();
	stdin.write("\r"); // select
	await tick();
	expect(lastFrame() ?? "").toContain("● unsaved");
});

test("s moves the category cursor from Themes to Options, listing Banding and Mood shift", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ rows: 90 })));
	await tick();
	stdin.write("2");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("s"); // category cursor Themes -> Options
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Options");
	expect(frame).toContain("Banding");
	expect(frame).toContain("Mood shift");
});

test("selecting Banding via enter advances it forward (solid -> cycle)", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("2"); // Theme
	await tick();
	stdin.write("\r"); // open content
	await tick();
	stdin.write("s"); // category cursor Themes -> Options
	await tick();
	stdin.write("d"); // focus the Options list (itemCursor reset to 0 -> Banding)
	await tick();
	expect(lastFrame() ?? "").toContain("Banding: solid");
	stdin.write("\r"); // activate: cycle Banding forward
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Banding: cycle");
	expect(frame).toContain("● unsaved");
});

test("toggling Mood shift via enter flips it", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("2"); // Theme
	await tick();
	stdin.write("\r"); // open content
	await tick();
	stdin.write("s"); // category cursor Themes -> Options
	await tick();
	stdin.write("d"); // focus the Options list
	await tick();
	stdin.write("j"); // itemCursor -> Mood shift
	await tick();
	expect(lastFrame() ?? "").toContain("Mood shift: ○ off");
	stdin.write("\r"); // activate: toggle Mood shift
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Mood shift: ● on");
	expect(frame).toContain("● unsaved");
});

test("at cols=80 the theme detail mini-statusline is gated out (helpful-tip overflows the narrow pane)", async () => {
	// The render pipeline at themeDetailCols=max(20, columns-65) produces a helpful-tip line whose
	// displayWidth exceeds that narrow gate threshold.  Before the fix (no gate) the overflowing
	// text is rendered in the detail pane — this test fails.  After the fix the gate sets body=""
	// and the ThemeSection shows only the swatch.
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ cols: 80 })));
	await tick();
	stdin.write("2"); // Theme section
	await tick();
	stdin.write("\r"); // open content
	await tick();
	expect(lastFrame() ?? "").not.toContain("bills per token");
});

test("at cols=120 the theme detail mini-statusline fits and is shown in the detail pane", async () => {
	// themeDetailCols=max(20, columns-65)=55; render at 55 cols produces a body that fits the gate.
	const { lastFrame, stdin } = render(createElement(Dashboard, base({ cols: 120 })));
	await tick();
	stdin.write("2"); // Theme section
	await tick();
	stdin.write("\r"); // open content
	await tick();
	expect(lastFrame() ?? "").toContain("bills per token");
});

test("selecting on the Roster toggles the pack under the moved item cursor, not another", async () => {
	// activateCharacter must read the fresh rail state passed in by handleCharacterKey. A fresh random roster is
	// empty (= all selected), so every pack starts marked; toggling the highlighted one deselects exactly it.
	// An implementation that acted on the wrong index would deselect the wrong pack, which the markers expose.
	const { lastFrame, stdin } = render(
		createElement(Dashboard, base({ packs: ["batman", "robin", "joker"] })),
	);
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content (Mode category)
	await tick();
	stdin.write("s"); // category cursor Mode -> Roster
	await tick();
	stdin.write("d"); // focus the Roster list (cursor at 0 = batman)
	await tick();
	stdin.write("s"); // itemCursor -> robin
	await tick();
	stdin.write("s"); // itemCursor -> joker
	await tick();
	stdin.write("\r"); // toggle joker (was all-selected); deselects exactly joker
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("○ joker"); // joker was deselected
	expect(frame).toContain("● batman"); // batman was left selected
});

test("re-entering Character after leaving mid-column resets rail focus to the category column", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content: rail focus starts on the category column
	await tick();
	stdin.write("d"); // focus the list column
	await tick();
	stdin.write("\t"); // Tab back to the sidebar without going through the rail's own exit
	await tick();
	stdin.write("\r"); // re-open Character
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("❯ Mode"); // the category column is focused again, on the first category
});
