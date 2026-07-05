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

const noop = (): void => {};

function base(over: Partial<DashboardProps> = {}): DashboardProps {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-sel-"));
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

test("the Character section opens on the Roster category with the pack union", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Roster");
	expect(frame).toContain("Browse");
	expect(frame).toContain("batman");
});

test("s switches the category cursor to Browse; an empty Browse shows the fallback line", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("1");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("s"); // category cursor Roster -> Browse
	await tick();
	expect(lastFrame() ?? "").toContain("no other packs available");
});

test("installing an uninstalled Browse pack runs the injected installer and updates the list", async () => {
	let resolveInstall: () => void = noop;
	const install = (): Promise<void> =>
		new Promise<void>((res) => {
			resolveInstall = res;
		});
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin"], installed: ["batman"], install }),
		),
	);
	await tick();
	stdin.write("1");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("s"); // category cursor -> Browse
	await tick();
	stdin.write("d"); // focus the list
	await tick();
	stdin.write("s"); // itemCursor -> robin
	await tick();
	stdin.write("\r"); // install
	await tick();
	expect(lastFrame() ?? "").toContain("Installing");
	resolveInstall();
	await tick();
	await tick();
	const done = lastFrame() ?? "";
	expect(done).not.toContain("Installing");
	expect(done).toContain(`● robin`); // now marked installed
});

test("the bundled pack is always treated as installed and never triggers a Browse install", async () => {
	// The bundled pack (batman) resolves at runtime via import.meta.resolve, so the node_modules
	// directory scan that seeds `installed` can miss it (hoisted/bundled). It must still be treated as
	// installed: pressing Enter on it selects it and never shells out `npm install @ccsidekick/pack-batman`.
	let installCalled = false;
	const install = (): Promise<void> => {
		installCalled = true;
		return Promise.reject(
			new Error("ccsidekick: npm install @ccsidekick/pack-batman exited 1"),
		);
	};
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin"], installed: ["robin"], install }),
		),
	);
	await tick();
	stdin.write("1");
	await tick();
	stdin.write("\r");
	await tick();
	stdin.write("s"); // category cursor -> Browse
	await tick();
	stdin.write("d"); // focus the list
	await tick();
	stdin.write("\r"); // Enter on batman (itemCursor reset to 0 by the category switch)
	await tick();
	await tick();
	const frame = lastFrame() ?? "";
	expect(installCalled).toBe(false);
	expect(frame).not.toContain("npm install");
	expect(frame).toContain(`● batman`); // shown as installed, not an install target
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

test("selecting on Browse acts on the pack under the moved item cursor, not index 0", async () => {
	// activateCharacter must read the fresh rail state passed in by handleCharacterKey (mirroring how
	// activateThemeRow reads r.state), not a stale characterRail closure. Move the item cursor past
	// index 0 before selecting: an implementation that acted on index 0 (or ignored the moved cursor)
	// would put batman in the roster instead of joker, which the Roster markers below expose.
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin", "joker"], installed: ["batman", "robin", "joker"] }),
		),
	);
	await tick();
	stdin.write("1"); // Character
	await tick();
	stdin.write("\r"); // open content
	await tick();
	stdin.write("s"); // category cursor -> Browse
	await tick();
	stdin.write("d"); // focus the list
	await tick();
	stdin.write("s"); // itemCursor -> robin
	await tick();
	stdin.write("s"); // itemCursor -> joker
	await tick();
	stdin.write("\r"); // select: must act on joker (the moved cursor), not batman (index 0)
	await tick();
	stdin.write("a"); // list -> category column
	await tick();
	stdin.write("w"); // category cursor Browse -> Roster
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("● joker"); // joker was added to the roster
	expect(frame).toContain("○ batman"); // batman was left alone
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
	expect(frame).toContain("❯ Roster"); // the category column is focused again, not the list column
});

test("a second Enter while installing is ignored and does not spawn a concurrent install", async () => {
	// Before the guard: installStatus==="installing" is not checked before spawning, so a
	// second Enter calls install() again — test fails with installCallCount=2.
	// After the guard: the handler returns immediately, count stays 1.
	let installCallCount = 0;
	let resolveInstall: () => void = noop;
	const install = (): Promise<void> => {
		installCallCount++;
		return new Promise<void>((res) => {
			resolveInstall = res;
		});
	};
	const { lastFrame, stdin } = render(
		createElement(
			Dashboard,
			base({ packs: ["batman", "robin"], installed: ["batman"], install }),
		),
	);
	await tick();
	stdin.write("1"); // Character section
	await tick();
	stdin.write("\r"); // open content
	await tick();
	stdin.write("s"); // category cursor -> Browse
	await tick();
	stdin.write("d"); // focus the list
	await tick();
	stdin.write("s"); // itemCursor -> robin
	await tick();
	stdin.write("\r"); // first Enter: starts install
	await tick();
	expect(lastFrame() ?? "").toContain("Installing"); // spinner visible
	stdin.write("\r"); // second Enter: must be guarded
	await tick();
	expect(installCallCount).toBe(1); // install called exactly once
	resolveInstall();
	await tick();
	await tick();
});
