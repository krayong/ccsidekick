import { afterEach, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { createElement } from "react";

import { THEMES } from "../../../src/data";
import { displayWidth } from "../../../src/render";
import { detectCapability, resolveTokens } from "../../../src/tui/theme";
import { Popup } from "../../../src/tui/widgets";

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

const hLines = (frame: string): number => frame.split("\n").filter((l) => l.includes("─")).length;

test("Popup draws a titled, footered rounded box centered within its frame and clips overflow", () => {
	const tall = createElement(
		Text,
		null,
		Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n"),
	);
	const frame =
		render(
			createElement(Popup, {
				title: "Help",
				footer: "esc close",
				columns: 100,
				rows: 24,
				tokens,
				children: tall,
			}),
		).lastFrame() ?? "";
	const lines = frame.split("\n");
	expect(frame).toContain("╭"); // rounded border
	expect(frame).toContain("╮");
	expect(frame).toContain("Help"); // title
	expect(frame).toContain("esc close"); // footer
	expect(lines.length).toBeLessThanOrEqual(24); // never taller than the frame
	// centered: the border does not start in column 0 (there is left padding to center it)
	const border = lines.find((l) => l.includes("╭")) ?? "";
	expect(border.indexOf("╭")).toBeGreaterThan(0);
});

test("Popup clips an overtall body instead of compressing lines into each other", () => {
	const region = 16;
	const bodyBox = createElement(
		Box,
		{ flexDirection: "column" },
		Array.from({ length: 60 }, (_, i) =>
			createElement(Text, { key: i }, `LINE${String(i).padStart(2, "0")}`),
		),
	);
	const frame =
		render(
			createElement(Popup, {
				title: "Save",
				footer: "esc close",
				columns: 60,
				rows: region,
				tokens,
				children: bodyBox,
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("LINE00");
	expect(frame.split("\n").length).toBeLessThanOrEqual(region);
	expect((frame.match(/LINE/g) ?? []).length).toBeLessThanOrEqual(region);
});

test("the popup draws a header-bottom and a footer-top divider (4 horizontal rules)", () => {
	const frame =
		render(
			createElement(Popup, {
				title: "Help",
				footer: "esc close",
				columns: 60,
				rows: 12,
				tokens,
				children: createElement(Text, null, "body text"),
			}),
		).lastFrame() ?? "";
	// outer top border, header divider, footer divider, outer bottom border = 4 rule lines
	expect(hLines(frame)).toBeGreaterThanOrEqual(4);
	expect(frame).toContain("Help");
	expect(frame).toContain("esc close");
});

test("the popup frame is a straight column: every frame row has the same display width", () => {
	const columns = 60;
	const wideBody = createElement(
		Text,
		null,
		Array.from({ length: 3 }, () => "🌿".repeat(40)).join("\n"), // far wider than the frame
	);
	const frame =
		render(
			createElement(Popup, {
				title: "Preview",
				footer: "esc close",
				columns,
				rows: 12,
				tokens,
				children: wideBody,
			}),
		).lastFrame() ?? "";
	const lines = frame.split("\n").filter((l) => l !== "");
	const widths = lines.map((l) => displayWidth(l));
	const first = widths[0] ?? -1;
	expect(first).toBeGreaterThan(0);
	for (const w of widths) expect(w).toBe(first);
});

test("the popup frame's width is pinned by columns alone, not auto-sized to content", () => {
	// Before the fix, the inner bordered box had no explicit width and auto-sized to whichever child
	// it was given, so a short body and a much wider, wide-glyph-heavy body rendered different frame
	// widths for the same `columns`. After the fix the frame width is a pure function of `columns`.
	const columns = 60;
	const rows = 12;
	const short = createElement(Text, null, "hi");
	const wide = createElement(Text, null, "🌿".repeat(80));
	const frameWidthOf = (children: ReturnType<typeof createElement>): number => {
		const frame =
			render(
				createElement(Popup, {
					title: "Preview",
					footer: "esc close",
					columns,
					rows,
					tokens,
					children,
				}),
			).lastFrame() ?? "";
		const border = frame.split("\n").find((l) => l.includes("╭")) ?? "";
		return displayWidth(border);
	};
	expect(frameWidthOf(wide)).toBe(frameWidthOf(short));
});

test("meta renders on the header's right side", () => {
	const frame =
		render(
			createElement(Popup, {
				title: "Find",
				footer: "esc close",
				columns: 60,
				rows: 12,
				tokens,
				meta: "4 matches",
				children: createElement(Text, null, "row"),
			}),
		).lastFrame() ?? "";
	expect(frame).toContain("Find");
	expect(frame).toContain("4 matches");
});
