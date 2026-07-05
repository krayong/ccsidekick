import { expect, test } from "bun:test";

import { FIGURE_COLS, type Field, type Segment, type TermContext } from "../domain";
import { DEFAULT_CONFIG } from "../sources";

import { layout, type LayoutInput } from "./layout";
import { stripAnsi } from "./strip";
import { resolveTheme } from "./theme";

const RESOLVED = resolveTheme(DEFAULT_CONFIG, () => null);

const FRAME: readonly string[] = Array.from({ length: 9 }, (_, i) => `#row${i}#`);

const field = (id: Field["id"], text: string): Field => ({
	id,
	segments: [{ role: "value", text }],
});

const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
	theme: RESOLVED,
	frame: FRAME,
	figure: { hues: RESOLVED.logo.hues },
	dropped: false,
	showChip: true,
	fields: [field("dir", "~/ccsidekick"), field("model", "Opus 4.8 (1M)")],
	helpful: null,
	character: null,
	name: "batman",
	emblem: "❝",
	mood: "idle",
	moodShift: false,
	now: 0,
	providerBadge: null,
	...over,
});

const term = (over: Partial<TermContext> = {}): TermContext => ({
	columns: 120,
	noColor: true,
	isTTY: true,
	...over,
});

test("narrow terminal drops the figure and leads with the [name] chip", () => {
	const out = layout(base({ dropped: true }), term({ columns: 40 }));
	const lines = stripAnsi(out).split("\n");
	expect(lines[0]?.startsWith("[batman] ")).toBe(true);
	// No figure column to the left: nothing precedes the chip.
	expect(lines.some((l) => l.includes("#row0#"))).toBe(false);
});

test("the chip renders a hyphenated pack name with spaces, not the raw slug", () => {
	const out = layout(base({ dropped: true, name: "harry-potter" }), term({ columns: 40 }));
	const lines = stripAnsi(out).split("\n");
	expect(lines[0]?.startsWith("[harry potter] ")).toBe(true);
});

test("the figure is painted from the logo hues and is glyph-stable", () => {
	const t = term({ noColor: false, isTTY: true, columns: 120 });
	const flat = layout(base({ figure: { hues: [250] } }), t); // one stop ⇒ uniform
	const shimmer = layout(base({ figure: { hues: [75, 147, 77, 222, 210] } }), t);
	expect(stripAnsi(flat)).toBe(stripAnsi(shimmer)); // glyphs untouched
	expect(shimmer).not.toBe(flat); // …but the colored bytes differ
});

test("blank figure cells keep the braille blank glyph (no ASCII-space skew); padding rows are trimmed", () => {
	const BLANK = "⠀"; // U+2800 braille blank
	const INK = "⣿";
	const blankRow = BLANK.repeat(FIGURE_COLS);
	const inkRow = INK.repeat(5) + BLANK.repeat(FIGURE_COLS - 5);
	// Leading + trailing blank padding rows around two ink rows separated by one interior blank row.
	const frame = [
		blankRow,
		blankRow,
		inkRow,
		blankRow,
		inkRow,
		...Array.from({ length: 4 }, () => blankRow),
	];
	const out = layout(
		base({ frame, fields: [], helpful: null, character: null }),
		term({ columns: 120 }),
	);
	const lines = stripAnsi(out).split("\n");
	// Leading/trailing blank padding rows are trimmed, so the logo starts on its first ink row — no forced blank top.
	expect(lines[0]).toContain(INK);
	// The ink row stays a solid braille rectangle: its trailing blanks are braille, never ASCII spaces.
	expect(lines[0]).toContain(BLANK);
	expect(lines[0]?.includes(" ")).toBe(false);
	// The interior blank row survives as FIGURE_COLS braille blanks (not collapsed, not ASCII spaces).
	expect([...(lines[1] ?? "")]).toEqual([...blankRow]);
	// Ink, interior blank, ink — the four trailing padding rows are gone — plus one bottom-gap row (block < 9).
	expect(lines.length).toBe(4);
	expect(lines.at(-1)).toBe(blankRow);
});

test("an ASCII-space blank in a figure row is normalized to a braille blank (no column skew)", () => {
	const INK = "⣿";
	const BLANK = "⠀"; // U+2800 braille blank
	// A row padded with an ASCII space (U+0020) interior blank — lint permits ASCII-space blanks, so the render
	// path must normalize them; a raw ASCII space would be yanked out by the host's whitespace strip and skew the row.
	const frame = [INK + " " + INK];
	const out = layout(
		base({ frame, fields: [], helpful: null, character: null }),
		term({ columns: 120 }),
	);
	const figCol = [...(stripAnsi(out).split("\n")[0] ?? "")].slice(0, FIGURE_COLS).join("");
	expect(figCol.includes(" ")).toBe(false); // no ASCII space survives in the figure column
	expect(figCol).toContain(BLANK); // the interior blank rendered as a braille blank
});

test("a figure narrower than the column is centered, with the odd blank on the right", () => {
	const INK = "⣿";
	const BLANK = "⠀";
	const frame = [INK.repeat(20)]; // width 20 ⇒ 5 blanks to split: 2 left, 3 right
	const out = layout(
		base({ frame, fields: [], helpful: null, character: null }),
		term({ columns: 120 }),
	);
	const figCol = [...(stripAnsi(out).split("\n")[0] ?? "")].slice(0, FIGURE_COLS).join("");
	expect(figCol).toBe(BLANK.repeat(2) + INK.repeat(20) + BLANK.repeat(3));
});

test("wide terminal renders the 9 figure rows plus the statusline", () => {
	const out = layout(base({ dropped: false }), term({ columns: 120 }));
	expect(stripAnsi(out).split("\n").length).toBeGreaterThanOrEqual(9);
	expect(stripAnsi(out)).toContain("Opus 4.8 (1M)");
});

test("NO_COLOR strips every escape", () => {
	const out = layout(
		base({
			helpful: { id: "x", severity: "high", text: "watch out" },
			character: { text: "I am vengeance" },
		}),
		term({ noColor: true, isTTY: true }),
	);
	expect(out).toBe(stripAnsi(out));
});

test("a non-TTY strips every escape", () => {
	const out = layout(
		base({ character: { text: "hello" } }),
		term({ noColor: false, isTTY: false }),
	);
	expect(out).toBe(stripAnsi(out));
});

test("the right column is vertically centered against the figure", () => {
	const out = layout(base({ character: { text: "I am the night" } }), term({ columns: 120 }));
	const lines = stripAnsi(out).split("\n");
	expect(lines.length).toBe(9); // figure height drives the block
	expect(lines[0]).toContain("#row0#"); // figure leads the top rows
	const charIdx = lines.findIndex((l) => l.includes("I am the night"));
	expect(charIdx).toBeGreaterThan(0); // centered, not bottom-anchored
	expect(charIdx).toBeLessThan(lines.length - 1);
});

test("a padded figure with no helpful comment does not render a forced blank top line", () => {
	const BLANK = "⠀";
	const INK = "⣿";
	const blankRow = BLANK.repeat(FIGURE_COLS);
	const inkRow = INK.repeat(8) + BLANK.repeat(FIGURE_COLS - 8);
	// A real-pack-shaped frame: 9 rows with blank top/bottom padding, art in the middle.
	const frame = [blankRow, blankRow, inkRow, inkRow, inkRow, inkRow, inkRow, blankRow, blankRow];
	const out = layout(
		base({ frame, fields: [field("dir", "~/ccsidekick")], helpful: null, character: null }),
		term({ columns: 120 }),
	);
	const lines = stripAnsi(out).split("\n");
	// The top row carries the trimmed logo's first ink row, not a forced blank padding line.
	expect(lines[0]).toContain(INK);
});

test("the figure gutter is braille-blank: comments stay indented and blank separator rows survive a host whitespace strip", () => {
	const INK = "⣿";
	const inkRow = INK.repeat(8) + "⠀".repeat(FIGURE_COLS - 8);
	const frame = [inkRow, inkRow, inkRow]; // a short logo (3 rows), shorter than the text column
	const out = layout(
		base({
			frame,
			fields: [field("dir", "~/x"), field("model", "Opus")],
			helpful: { id: "h", severity: "high", text: "watch out" },
			character: { text: "I am the night" },
		}),
		term({ columns: 120 }),
	);
	const lines = stripAnsi(out).split("\n");
	// No line begins with an ASCII space — the gutter is braille-blank (U+2800), which a leading-whitespace strip
	// leaves alone. (ASCII-space fill would yank the comments to column 0.)
	expect(lines.some((l) => l.startsWith(" "))).toBe(false);
	// Every row is non-empty (the all-braille separator rows are not dropped by an empty-line strip).
	expect(lines.every((l) => l.length > 0)).toBe(true);
	// Helpful and character lead with the braille gutter, so they sit indented under the statusline.
	expect(lines.find((l) => l.includes("watch out"))?.startsWith("⠀")).toBe(true);
	expect(lines.find((l) => l.includes("I am the night"))?.startsWith("⠀")).toBe(true);
});

test("dropped chip mode keeps braille-blank section separators and a bottom gap (host-safe)", () => {
	const out = layout(
		base({
			dropped: true,
			helpful: { id: "h", severity: "high", text: "watch out" },
			character: { text: "I am vengeance" },
		}),
		term({ columns: 80 }),
	);
	const lines = stripAnsi(out).split("\n");
	expect(lines[0]).toContain("watch out"); // helpful leads
	// The separators are braille-blank (U+2800), not empty strings — the host would drop empty lines, cramping
	// the sections together.
	expect(lines[1]).toBe("⠀"); // blank after helpful
	const chIdx = lines.findIndex((l) => l.includes("I am vengeance"));
	expect(lines[chIdx - 1]).toBe("⠀"); // blank before the character comment
	expect(lines.at(-1)).toBe("⠀"); // bottom gap so the block does not touch the last row
	expect(lines.every((l) => l.length > 0)).toBe(true); // no empty lines for the host to strip
});

test("any sub-9 block gets one bottom-gap row, whether the text or the figure is the taller side", () => {
	const INK = "⣿";
	const short = (n: number) =>
		Array.from({ length: n }, () => INK.repeat(6) + "⠀".repeat(FIGURE_COLS - 6));
	// RH = statusline(1) + blank + character(1) = 3 > figure(1), and < 9 ⇒ one bottom gap row.
	const tallRight = layout(
		base({ frame: short(1), fields: [field("dir", "~/x")], character: { text: "night" } }),
		term({ columns: 120 }),
	);
	const rLines = stripAnsi(tallRight).split("\n");
	expect(rLines.length).toBe(4); // 3 RH rows + 1 gap
	expect(rLines.at(-1)).toBe("⠀".repeat(FIGURE_COLS)); // trailing braille-blank gap row

	// Figure(5) taller than RH(1) but still < 9 ⇒ it too gets a bottom-gap row.
	const tallFig = layout(
		base({ frame: short(5), fields: [field("dir", "~/x")], character: null }),
		term({ columns: 120 }),
	);
	const fLines = stripAnsi(tallFig).split("\n");
	expect(fLines.length).toBe(6); // 5 figure rows + 1 gap
	expect(fLines.at(-1)).toBe("⠀".repeat(FIGURE_COLS)); // trailing braille-blank gap row
});

test("with a bottom gap, the figure gains a matching top space (centered against the gap-inclusive canvas)", () => {
	const INK = "⣿";
	const figRow = INK.repeat(6) + "⠀".repeat(FIGURE_COLS - 6);
	// figure = 4 rows; RH = statusline(3 rows) + blank + character = 5 > 4 and < 9 ⇒ bottom gap, canvas = 6.
	const out = layout(
		base({
			frame: [figRow, figRow, figRow, figRow],
			fields: [field("dir", "~/x"), field("cost_chat", "$1"), field("context_usage", "42%")],
			helpful: null,
			character: { text: "night" },
		}),
		term({ columns: 120 }),
	);
	const lines = stripAnsi(out).split("\n");
	expect(lines.length).toBe(6); // 5 RH rows + 1 bottom gap
	// figure centered in the 6-row canvas ⇒ first ink row at index 1 (a top gutter space), not flush at 0.
	expect(lines.findIndex((l) => l.startsWith(INK))).toBe(1);
	expect(lines[0]?.startsWith("⠀")).toBe(true); // the top row is a gutter, mirroring the bottom gap
	expect(lines.at(-1)).toBe("⠀".repeat(FIGURE_COLS)); // bottom gap
});

test("cycle banding colors adjacent cells on a row with different hues", () => {
	const cycle = resolveTheme(
		{ ...DEFAULT_CONFIG, theme: { ...DEFAULT_CONFIG.theme, banding: "cycle" } },
		() => null,
	);
	const hues = cycle.statusline.hues;
	// Two cells on one row: under cycle the first is hues[0], the second hues[1].
	const out = layout(
		base({
			theme: cycle,
			fields: [field("cost_chat", "$1.23"), field("cost_total", "$44.10")],
		}),
		term({ noColor: false, isTTY: true, columns: 120 }),
	);
	expect(out).toContain(`38;5;${hues[0]}m$1.23`); // first cell: hues[0]
	expect(out).toContain(`38;5;${hues[1]}m$44.10`); // second cell: hues[1]
});

test("a colored separator joins same-row statusline cells", () => {
	const out = layout(base(), term({ noColor: false, isTTY: true, columns: 120 }));
	// dir and model are on different rows, so put two cost cells on one row.
	const costRow = layout(
		base({ fields: [field("cost_chat", "$1.23"), field("cost_total", "$44.10")] }),
		term({ noColor: false, isTTY: true, columns: 120 }),
	);
	expect(out).toContain("\x1b["); // SGR escapes present when colored
	expect(stripAnsi(costRow)).toContain("│");
});

test("an href segment is a dotted-underlined, clickable OSC 8 hyperlink; suppressed under NO_COLOR", () => {
	const linked: Field = {
		id: "pr",
		segments: [
			{ role: "value", text: "PR:" },
			{ role: "value", text: "#42", href: "https://example.test/pull/42" },
		],
	};
	const colored = layout(
		base({ fields: [linked] }),
		term({ noColor: false, isTTY: true, columns: 120 }),
	);
	expect(colored).toContain("\x1b]8;;https://example.test/pull/42\x07"); // opening hyperlink
	expect(colored).toContain("\x1b]8;;\x07"); // closing hyperlink
	expect(colored).toContain("\x1b[4:4;38;5;"); // dotted-underline SGR on the link
	expect(stripAnsi(colored)).toContain("PR: #42"); // both segments, SGR + OSC8 stripped
	// the `PR:` lead-in is not part of the hyperlink span
	expect(colored.indexOf("PR:")).toBeLessThan(colored.indexOf("\x1b]8;;https"));

	// NO_COLOR / a non-TTY emits plain text: no link escape, no underline.
	const plain = layout(base({ fields: [linked] }), term({ noColor: true, isTTY: true }));
	expect(plain.includes("\x1b]8")).toBe(false);
	expect(plain.includes("\x1b[4:4")).toBe(false);
	expect(plain).toContain("PR: #42");
});

test("an href URL is stripped of control bytes before the OSC 8 wrap", () => {
	const evil: Field = {
		id: "pr",
		segments: [{ role: "value", text: "#42", href: "https://x/\x07\x1b]0;pwn" }],
	};
	const out = layout(
		base({ fields: [evil] }),
		term({ noColor: false, isTTY: true, columns: 120 }),
	);
	// the injected BEL/ESC are stripped from the URL; only the renderer's own OSC 8 frame uses them
	expect(out).toContain("\x1b]8;;https://x/]0;pwn\x07");
});

test("the helpful line is truncated to the right-zone width", () => {
	const long = "z".repeat(200);
	const out = layout(
		base({ helpful: { id: "h", severity: "low", text: long } }),
		term({ columns: 120, noColor: true, isTTY: true }),
	);
	const rw = 120 - 27; // right-zone width = columns − (FIGURE_COLS + GAP)
	for (const line of stripAnsi(out).split("\n")) {
		expect([...line].length).toBeLessThanOrEqual(120); // no line exceeds the terminal
		// The right zone (after the 25-col figure + 2-col gap) is truncated to rw.
		expect([...line].slice(FIGURE_COLS + 2).length).toBeLessThanOrEqual(rw);
	}
});

test("a malicious pack string with ESC/OSC/control bytes is stripped from the output", () => {
	const evil = "evil\x1b]0;pwn\x07more\x1b[31mRED\x07\x9b2Jtail";
	const out = layout(
		base({ character: { text: evil } }),
		term({ noColor: false, isTTY: true, columns: 120 }), // colored: SGR allowed, pack escapes not
	);
	// After stripping the renderer's own SGR, no ESC byte survives ⇒ no pack escape leaked.
	expect(stripAnsi(out).includes("\x1b")).toBe(false);
	expect(out.includes("\x1b]")).toBe(false); // no OSC
	expect(out.includes("pwn")).toBe(false); // OSC payload gone
	expect(out.includes("\x07")).toBe(false); // no BEL
	expect(out.includes("\x9b")).toBe(false); // no C1 CSI
	expect(stripAnsi(out)).toContain("evil"); // benign text survives
});

test("a malicious external field value (dir) is stripped, colored and NO_COLOR", () => {
	const evil = "/home\x1b]0;pwn\x07x\x1b[31mY\x9b2Jtail";
	for (const t of [
		term({ noColor: false, isTTY: true, columns: 120 }), // colored: SGR allowed, payload escapes not
		term({ noColor: true, isTTY: true, columns: 120 }), // NO_COLOR: fg adds nothing, must still strip
	]) {
		const out = layout(base({ fields: [field("dir", evil)] }), t);
		expect(stripAnsi(out).includes("\x1b")).toBe(false); // no leaked ESC after our own SGR is stripped
		expect(out.includes("\x1b]")).toBe(false); // no OSC
		expect(out.includes("pwn")).toBe(false); // OSC payload gone
		expect(out.includes("\x07")).toBe(false); // no BEL
		expect(out.includes("\x9b")).toBe(false); // no C1 CSI
		expect(stripAnsi(out)).toContain("/home"); // benign path text survives
		expect(stripAnsi(out)).toContain("tail");
	}
});

test("the provider badge leads the model row when present and is absent when null", () => {
	const badge: Segment[] = [{ role: "value", text: "🔑 api | " }];
	const noBadge = stripAnsi(layout(base({ providerBadge: null }), term({ columns: 120 })));
	expect(noBadge).not.toContain("🔑 api");

	const withBadge = stripAnsi(layout(base({ providerBadge: badge }), term({ columns: 120 })));
	const modelLine = withBadge.split("\n").find((l) => l.includes("Opus 4.8 (1M)"));
	expect(modelLine).toContain("🔑 api | ");
	// the badge leads: its emoji precedes the model value on the same row
	expect(modelLine?.indexOf("🔑")).toBeLessThan(modelLine?.indexOf("Opus") ?? -1);
});

test("under width pressure, protected fields survive while droppable flags shed", () => {
	const model: Field = {
		id: "model",
		segments: [
			{ role: "value", text: "Claude Opus 4.8" },
			{ role: "value", text: "(1M) ✦ high" },
		],
	};
	const fields: Field[] = [
		model,
		field("fast_mode", "Fast"),
		field("thinking", "Thinking…"),
		field("dir", "~/some/very/long/path/that/eats/the/width"),
	];
	const row1 = stripAnsi(layout(base({ fields }), term({ columns: 60 })))
		.split("\n")
		.find((l) => l.includes("Opus"));
	expect(row1).toBeDefined();
	expect(row1).toContain("Opus"); // model survives (protected)
	expect(row1).toContain("~"); // dir survives (protected), possibly truncated
	expect(row1).toContain("(1M) ✦ high"); // model's protected tail is intact (model isn't the truncated cell)
	expect(row1?.includes("Fast")).toBe(false); // a non-protected flag was shed
	expect(row1?.includes("Thinking")).toBe(false);
});

test("when the model cell itself must truncate, the context size + effort survive and the name ellipsizes", () => {
	const model: Field = {
		id: "model",
		segments: [
			{ role: "value", text: "Claude Opus 4.8 Some Very Long Variant Name" },
			{ role: "value", text: "(1M) ✦ high" },
		],
	};
	const row1 = stripAnsi(layout(base({ fields: [model] }), term({ columns: 55 })))
		.split("\n")
		.find((l) => l.includes("(1M)"));
	expect(row1).toBeDefined();
	expect(row1).toContain("(1M) ✦ high"); // protected tail kept whole
	expect(row1).toContain("…"); // the model name was ellipsized, not the tail
});

test("a promoted lone git_branch renders on row 1, after the dir cluster and before the model", () => {
	const fields: Field[] = [
		field("dir", "~/proj"),
		field("session_name", "spike"),
		field("model", "Opus 4.8"),
		field("git_branch", "main"),
	];
	const row1 =
		stripAnsi(layout(base({ fields }), term({ columns: 120 })))
			.split("\n")
			.find((l) => l.includes("Opus")) ?? "";
	const iDir = row1.indexOf("~/proj");
	const iBranch = row1.indexOf("main");
	const iModel = row1.indexOf("Opus");
	expect(iDir).toBeGreaterThanOrEqual(0);
	expect(iDir).toBeLessThan(iBranch); // branch comes after the location cluster
	expect(iBranch).toBeLessThan(iModel); // …and before the model
});

test("the ⋯ placeholder segment renders faint in the separator color", () => {
	const t = term({ noColor: false, isTTY: true, columns: 120 });
	const out = layout(
		base({ fields: [{ id: "cost_chat", segments: [{ role: "placeholder", text: "⋯" }] }] }),
		t,
	);
	// Faint (SGR 2) + separator color, a static dim — never a blink (SGR 5).
	expect(out).toContain(`\x1b[2;38;5;${RESOLVED.statusline.separator}m⋯`);
	expect(out).not.toContain("\x1b[5m");
});
