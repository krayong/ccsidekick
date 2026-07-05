import { expect, test } from "bun:test";

import { figuresHtml } from "./figure-options";
import { themesHtml } from "./theme-options";

test("figuresHtml renders each candidate's rows in a monospace pre, HTML-escaped", () => {
	const html = figuresHtml([
		{ name: "A", rows: ["<x>", "  ok  "] },
		{ name: "B", rows: ["██"] },
	]);
	expect(html).toContain("<pre");
	expect(html).toContain("&lt;x&gt;"); // escaped, not raw <x>
	expect(html).toContain("A");
	expect(html).toContain("██");
});

test("themesHtml colors the statusline + logo with inline hex spans, no ANSI", () => {
	const pack = { displayName: "T", emblem: "◆", art: ["██", "░░"], lines: {} };
	const cand = {
		name: "c1",
		hues: [75, 147, 77, 222, 210],
		comment: [75, 147, 222],
		signals: { nominal: 77, caution: 214, critical: 203 },
		separator: 147,
	};
	const html = themesHtml(pack, [cand]);
	expect(html).toContain('<span style="color:#');
	expect(html).not.toContain("\x1b[");
	expect(html).toContain("c1");
});
