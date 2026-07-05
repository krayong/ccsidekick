import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { DEFAULT_CONFIG } from "../../../src/sources";
import { SCENARIOS } from "../../../src/tui/preview";
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
	return {
		targets: [{ dir, scope: "global" }],
		env: { TERM: "xterm-256color" },
		cols: 100,
		rows: 40,
		initialConfig: DEFAULT_CONFIG,
		...over,
	};
}

test("the preview is closed by default", async () => {
	const { lastFrame } = render(createElement(Dashboard, base()));
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).not.toContain("Preview");
});

test("ctrl+p opens a centered preview popup with the scenario label", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Preview"); // popup title
	expect(frame).toContain("API key"); // first scenario
});

test(", and . cycle the scenario while the preview popup is open", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	stdin.write(".");
	await tick();
	expect(lastFrame() ?? "").toContain("Bedrock"); // second scenario
	stdin.write(",");
	await tick();
	expect(lastFrame() ?? "").toContain("API key");
});

test("ctrl+p closes the preview popup once it is open", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	expect(lastFrame() ?? "").toContain("Preview");
	stdin.write("\x10"); // Ctrl+P
	await tick();
	expect(lastFrame() ?? "").not.toContain("Preview");
});

test("esc closes the preview popup", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	expect(lastFrame() ?? "").toContain("Preview");
	stdin.write("\x1b"); // Escape
	await tick();
	expect(lastFrame() ?? "").not.toContain("Preview");
});

test("ctrl+p renders the scenario body (figure + statusline), not a blank popup", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P: open preview
	await tick();
	await tick(); // renderScenario writes a scratch fixture; give it a beat
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Preview —"); // header label lands (after Step 3)
	// BODY content from the real pipeline — a braille figure glyph OR the Cost field label.
	expect(/[⣿⠿⠋]/.test(frame) || frame.includes("Cost")).toBe(true);
});

test("w toggles narrow/width in the preview; m is inert", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	expect(lastFrame() ?? "").toContain("wide");
	stdin.write("m"); // no longer bound to anything in the preview overlay
	await tick();
	expect(lastFrame() ?? "").toContain("wide");
	expect(lastFrame() ?? "").not.toContain("narrow");
	stdin.write("w");
	await tick();
	expect(lastFrame() ?? "").toContain("narrow");
});

test("the preview force-enables the compactions/todo widgets so the fixture's demo data shows", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	await tick(); // renderScenario writes a scratch fixture; give it a beat
	const frame = lastFrame() ?? "";
	expect(frame).toContain("Compactions:");
	expect(frame).toContain("Wire up the compaction widget"); // the seeded in-progress todo's content
});

test("the preview never persists the compactions/todo force-enable into the saved draft", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P: open and close the preview, which force-enables compactions/todo
	await tick(); // for its own render only
	await tick();
	stdin.write("\x10");
	await tick();
	stdin.write("6"); // Statusline section
	await tick();
	stdin.write("\r"); // open content: rail starts on the Format category
	await tick();
	stdin.write("s"); // s/w move the category column (down/up); step to Context (index 3)
	await tick();
	stdin.write("s");
	await tick();
	stdin.write("s");
	await tick();
	stdin.write("d"); // focus the items list
	await tick();
	stdin.write("s"); // Context's items are [context_usage, compactions, ...]; step to compactions
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("○ compactions"); // still off in the saved draft, untouched by the preview
});

test("a long project path visibly truncates with an ellipsis at narrow preview width", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("\x10"); // Ctrl+P
	await tick();
	const longIndex = SCENARIOS.findIndex((s) => s.label === "Long project path");
	for (let i = 0; i < longIndex; i++) {
		stdin.write(".");
		await tick();
	}
	stdin.write("w"); // narrow
	await tick();
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).toContain("…");
});

test("typing into a text field does not fire the preview keys", async () => {
	const { lastFrame, stdin } = render(createElement(Dashboard, base()));
	await tick();
	stdin.write("6"); // Statusline section
	await tick();
	stdin.write("\r"); // open content: the rail starts on the Format category
	await tick();
	stdin.write("d"); // focus the Format list (Currency row)
	await tick();
	stdin.write("j"); // itemCursor -> Budget row
	await tick();
	stdin.write("\r"); // begin editing the Budget number field
	await tick();
	stdin.write("n"); // should type into the buffer, not toggle preview color
	await tick();
	const frame = lastFrame() ?? "";
	expect(frame).not.toContain("no-color"); // preview color flag NOT flipped by the buffered "n"
	expect(frame).toContain("n█"); // the buffered keystroke landed in the field, caret and all
});
