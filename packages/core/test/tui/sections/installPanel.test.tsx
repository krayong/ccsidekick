import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { InstallPanel, type InstallPanelProps } from "../../../src/tui/sections";
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

const base = (over: Partial<InstallPanelProps>): InstallPanelProps => ({
	scope: "global",
	dirty: false,
	targets: [{ dir: "/home/dev/.claude", scope: "global" }],
	tokens,
	...over,
});

// The active toggle option is marked with tokens.accent; extract its opening SGR sequence so a test can
// confirm which word (global or local) it wraps without depending on adjacent plain text staying contiguous
// across a styled/unstyled boundary (see the reducedMotion SGR check in appShell.test.tsx for precedent).
const accentSgr = (): string => {
	const ref = render(createElement(Text, { ...tokens.accent }, "X")).lastFrame() ?? "";
	return ref.slice(0, ref.indexOf("X"));
};

test("the panel shows the scope, target dir, and a save prompt", () => {
	const frame = render(createElement(InstallPanel, base({}))).lastFrame() ?? "";
	expect(frame).toContain("global");
	expect(frame).toContain("/home/dev/.claude");
	expect(frame.toLowerCase()).toContain("install");
});

test("a local project target (one with a cwd) renders a [global | local] toggle with a space hint", () => {
	const frame =
		render(
			createElement(
				InstallPanel,
				base({
					scope: "mixed",
					targets: [
						{ dir: "/home/dev/.claude", scope: "global" },
						{ dir: "/proj/.claude", scope: "local", cwd: "/proj" },
					],
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("global");
	expect(frame).toContain("local");
	expect(frame).toContain("space");
	expect(frame).toContain("toggle scope");
	// The active option (local) is marked with the accent color.
	expect(frame).toContain(`${accentSgr()}local`);
});

test("the toggle marks whichever option is currently active", () => {
	const frame =
		render(
			createElement(
				InstallPanel,
				base({
					scope: "mixed",
					targets: [
						{ dir: "/home/dev/.claude", scope: "global" },
						{ dir: "/proj/.claude", scope: "global", cwd: "/proj" },
					],
				}),
			),
		).lastFrame() ?? "";
	expect(frame).toContain(`${accentSgr()}global`);
});

test("a home target (no cwd) renders a fixed global label, no toggle", () => {
	const frame =
		render(
			createElement(
				InstallPanel,
				base({ targets: [{ dir: "/home/dev/.claude", scope: "global" }] }),
			),
		).lastFrame() ?? "";
	expect(frame).not.toContain("toggle scope");
});
