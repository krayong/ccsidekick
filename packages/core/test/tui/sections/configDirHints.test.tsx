// The Welcome screen's hint copy, checked directly against the mock: the multi-dir picker's list-mode hint
// string, and the single-dir confirm's path-free rendering.

import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { ConfigDirPicker, SingleDirConfirm } from "../../../src/tui/sections";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

test("the multi-dir picker shows the mock's list-mode hint", () => {
	const frame =
		render(
			createElement(ConfigDirPicker, {
				dirs: [
					{ dir: "/home/u/.claude", scope: "global" as const },
					{ dir: "/home/u/work/.claude", scope: "global" as const },
				],
				suggestedIndex: 0,
				suggested: "/home/u/.claude",
				onChosen: () => {},
				onQuit: () => {},
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("space pick · a all · ↵ continue · esc/q quit");
});

test("the single-dir confirm shows no directory path", () => {
	const frame =
		render(
			createElement(SingleDirConfirm, {
				target: { dir: "/home/u/.claude", scope: "global" as const },
				onChosen: () => {},
				onQuit: () => {},
			}),
		).lastFrame() ?? "";
	expect(frame).not.toContain("/home/u/.claude");
	expect(frame).toContain("Press ↵ to set up");
});
