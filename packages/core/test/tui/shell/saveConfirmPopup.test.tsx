import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { type SaveConfirmPopupProps, SaveConfirmPopup } from "../../../src/tui/shell";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const tokens = resolveTokens(THEMES.houston, detectCapability({ TERM: "xterm-256color" }));

function base(over: Partial<SaveConfirmPopupProps> = {}): SaveConfirmPopupProps {
	return {
		targets: [{ dir: "/tmp/ccsidekick-save-confirm-test", scope: "global" }],
		body: "STATUSLINE-PREVIEW-BODY",
		charLabel: "batman",
		index: 0,
		count: 3,
		offsetX: 0,
		offsetY: 0,
		viewportRows: 12,
		error: null,
		columns: 100,
		rows: 40,
		tokens,
		...over,
	};
}

test("the carousel shows the scope, target dir, character label, and rendered body", () => {
	const frame = render(createElement(SaveConfirmPopup, base())).lastFrame() ?? "";
	expect(frame).toContain("global");
	expect(frame).toContain("/tmp/ccsidekick-save-confirm-test");
	expect(frame).toContain("batman");
	expect(frame).toContain("STATUSLINE-PREVIEW-BODY");
});

test("the meta shows the 1-based position and character count", () => {
	const frame =
		render(createElement(SaveConfirmPopup, base({ index: 1, count: 3 }))).lastFrame() ?? "";
	expect(frame).toContain("2/3 characters");
});

test("an error renders in the alert banner", () => {
	const frame =
		render(createElement(SaveConfirmPopup, base({ error: "install failed" }))).lastFrame() ??
		"";
	expect(frame).toContain("install failed");
});
