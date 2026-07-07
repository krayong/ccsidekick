import { afterEach, expect, test } from "bun:test";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { type SaveTarget, type WelcomeProps, Welcome } from "../../../src/tui/shell";
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

const cap = detectCapability({ TERM: "xterm-256color" });
const tokens = resolveTokens(THEMES.houston, cap);

const g = (dir: string): SaveTarget => ({ dir, scope: "global" });

function base(over: Partial<WelcomeProps> = {}): WelcomeProps {
	return {
		dirs: [g("/home/dev/.claude")],
		suggestedIndex: 0,
		onChosen: () => {},
		columns: 100,
		rows: 30,
		atFloor: false,
		hues: THEMES.houston.hues,
		capability: cap,
		tokens,
		...over,
	};
}

test("with several config dirs the Welcome shows the logo, a description, and the dir picker", () => {
	const frame =
		render(
			createElement(
				Welcome,
				base({ dirs: [g("/home/dev/.claude"), g("/home/dev/.config/claude")] }),
			),
		).lastFrame() ?? "";
	expect(frame).toContain("█"); // the wordmark
	expect(frame.toLowerCase()).toContain("claude code"); // the one-line description
	expect(frame).toContain("/home/dev/.claude"); // the picker's dir row
	expect(frame).toContain("Custom path…"); // the picker's custom entry
});

test("with a single config dir the Welcome shows a press-enter confirm, not the picker", () => {
	const frame =
		render(createElement(Welcome, base({ dirs: [g("/home/dev/.claude")] }))).lastFrame() ?? "";
	expect(frame).toContain("█"); // still the wordmark
	expect(frame).not.toContain("/home/dev/.claude"); // path-less confirm
	expect(frame).toContain("Press ↵ to set up · esc/q quit"); // the press-enter/quit hint
	expect(frame).not.toContain("Custom path…"); // no picker chrome
	expect(frame).not.toContain("[ ]"); // no checkboxes
});

test("pressing enter on the single-dir confirm chooses that target", async () => {
	const calls: (readonly SaveTarget[])[] = [];
	const target = g("/home/dev/.claude");
	const { stdin } = render(
		createElement(
			Welcome,
			base({
				dirs: [target],
				onChosen: (targets) => {
					calls.push(targets);
				},
			}),
		),
	);
	await new Promise((r) => setTimeout(r, 25)); // let the input hook mount before writing
	stdin.write("\r");
	await new Promise((r) => setTimeout(r, 25));
	expect(calls).toEqual([[target]]);
});

test("esc quits the single-dir confirm via onQuit", async () => {
	let quit = false;
	const { stdin } = render(
		createElement(
			Welcome,
			base({ dirs: [g("/home/dev/.claude")], onQuit: () => (quit = true) }),
		),
	);
	await new Promise((r) => setTimeout(r, 25));
	stdin.write("\x1b"); // Escape
	await new Promise((r) => setTimeout(r, 25));
	expect(quit).toBe(true);
});

test("q quits the single-dir confirm via onQuit", async () => {
	let quit = false;
	const { stdin } = render(
		createElement(
			Welcome,
			base({ dirs: [g("/home/dev/.claude")], onQuit: () => (quit = true) }),
		),
	);
	await new Promise((r) => setTimeout(r, 25));
	stdin.write("q");
	await new Promise((r) => setTimeout(r, 25));
	expect(quit).toBe(true);
});

test("esc quits the multi-target picker via onQuit", async () => {
	let quit = false;
	const { stdin } = render(
		createElement(
			Welcome,
			base({
				dirs: [g("/home/dev/.claude"), g("/home/dev/.config/claude")],
				onQuit: () => (quit = true),
			}),
		),
	);
	await new Promise((r) => setTimeout(r, 25));
	stdin.write("\x1b"); // Escape
	await new Promise((r) => setTimeout(r, 25));
	expect(quit).toBe(true);
});

test("q quits the multi-target picker via onQuit", async () => {
	let quit = false;
	const { stdin } = render(
		createElement(
			Welcome,
			base({
				dirs: [g("/home/dev/.claude"), g("/home/dev/.config/claude")],
				onQuit: () => (quit = true),
			}),
		),
	);
	await new Promise((r) => setTimeout(r, 25));
	stdin.write("q");
	await new Promise((r) => setTimeout(r, 25));
	expect(quit).toBe(true);
});

test("below the wordmark width the Welcome falls back to a plain brand line", () => {
	const frame = render(createElement(Welcome, base({ columns: 60 }))).lastFrame() ?? "";
	expect(frame).not.toContain("█"); // logo suppressed
	expect(frame).toContain("ccsidekick"); // plain brand still present
});

test("at the floor the Welcome drops the border for a plain brand line", () => {
	const above = render(createElement(Welcome, base())).lastFrame() ?? "";
	expect(above).toContain("╭"); // a round border is present above the floor
	const atFloor = render(createElement(Welcome, base({ atFloor: true }))).lastFrame() ?? "";
	expect(atFloor).not.toContain("╭"); // border dropped at the floor
	expect(atFloor).toContain("ccsidekick"); // plain brand line remains
	expect(atFloor.toLowerCase()).toContain("resize"); // the resize hint appears
});
