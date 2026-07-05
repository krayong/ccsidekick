// Two-zone compose + width fitting + the chip fallback. The figure zone (≤ 9
// rows × 25 cols, trimmed to its art height) sits at the absolute left; the right column holds an optional
// helpful comment (then a blank) above the statusline rows, and an optional character comment (after a blank)
// below them, the logo centered against that text block (the shorter of the two centers within the taller, the
// odd row skewing to the bottom; a sub-9 text block taller than the figure gets one bottom gap row). Fitting is a render
// concern and happens here: the statusline drop order + last-value truncation, and the helpful/character lines
// truncated to the right-zone width. Below MIN_RIGHT_WIDTH (or when the pack failed to load) the figure is
// dropped and the statusline leads with a `[<name>] │` chip. Pure: every TTY/NO_COLOR decision comes from the
// injected TermContext.
//
// HARD RULE — terminal-injection sanitization: every externally-sourced text value — pack free text (the
// character line, the emblem, the character name) AND statusline segment text (e.g. `dir` from the payload
// cwd, `session_name`, `todo` content, the provider badge) — is stripped of all C0/C1 control bytes and ESC
// sequences BEFORE the renderer wraps it in color, so the only escapes in the emitted result are ones the
// renderer itself added: the SGR color sequences, plus an OSC 8 hyperlink for a segment carrying an `href`
// (the URL is sanitized in `osc8`, so it too cannot inject). This holds on both the colored and the
// NO_COLOR / non-TTY paths (the OSC 8 wrap, like color, is suppressed under NO_COLOR / a non-TTY).

import { dropOrder, isProtected, rowFor, type RowId } from "../compose";
import {
	FIGURE_COLS,
	FIGURE_ROWS,
	GAP,
	MIN_RIGHT_WIDTH,
	type CharacterComment,
	type Field,
	type HelpfulComment,
	type RenderMood,
	type Segment,
	type TermContext,
} from "../domain";

import { fg, fgBold, fgFaint, fgLink, gradient, osc8 } from "./color";
import { figureColor } from "./figure";
import { displayWidth, stripAnsi } from "./strip";
import {
	accentColor,
	applyMood,
	helpfulStyle,
	signalColor,
	valueColor,
	type ResolvedTheme,
} from "./theme";

export interface LayoutInput {
	readonly theme: ResolvedTheme;
	/** The figure's rows; ignored when `dropped`. */
	readonly frame: readonly string[];
	/** The figure's resolved logo gradient stops (the logo surface `hues`). */
	readonly figure: {
		readonly hues: readonly number[];
	};
	/** True when the figure is dropped (terminal too narrow, the pack failed to load, or the character is off). */
	readonly dropped: boolean;
	/**
	 * When `dropped`, whether to lead the statusline with the `[name]` identity chip. The narrow-terminal and
	 * pack-load-failure drops keep the chip (identity must survive); a deliberately disabled character omits it.
	 */
	readonly showChip: boolean;
	/** The composed statusline fields, in registry order. */
	readonly fields: readonly Field[];
	readonly helpful: HelpfulComment | null;
	readonly character: CharacterComment | null;
	/** The provider badge segments that lead the model row, or null under a subscription. */
	readonly providerBadge: readonly Segment[] | null;
	/** The active character name, for the dropped-figure chip. */
	readonly name: string;
	/** The character's emblem glyph (sourced from the pack); shown to the left of the comment text. */
	readonly emblem: string;
	readonly mood: RenderMood;
	/** Gates the figure mood effect and the static accent/comment mood tint. */
	readonly moodShift: boolean;
	readonly now: number;
}

const SEP_GLYPH = "│";

/** Strip every ESC sequence and C0/C1 control byte from pack free text before it is colorized. */
const sanitizePackText = (s: string): string =>
	s
		// eslint-disable-next-line no-control-regex, regexp/no-obscure-range -- matches a literal CSI sequence: ESC [, ECMA-48 parameter bytes, intermediate bytes (0x20–0x2F) and a final byte (0x40–0x7E)
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
		// eslint-disable-next-line no-control-regex -- matches a literal OSC 8 frame terminated by BEL or ST (ESC \)
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … BEL/ST
		// eslint-disable-next-line no-control-regex, regexp/no-obscure-range -- matches a 2-byte ESC sequence: ESC + a Fe final byte (0x40–0x5F)
		.replace(/\x1b[@-_]/g, "") // other 2-byte ESC sequences
		// eslint-disable-next-line no-control-regex -- intentionally strips every remaining C0/C1 control byte
		.replace(/[\x00-\x1f\x7f-\x9f]/gu, ""); // any remaining C0/C1 control byte

const rtrim = (s: string): string => s.replace(/\s+$/u, "");

/** Hard-slice plain text to `width` display columns (`width - 1` + an ellipsis when over). */
const truncToWidth = (s: string, width: number): string => {
	if (displayWidth(s) <= width) return s;
	if (width <= 1) return "…";
	let out = "";
	let w = 0;
	for (const ch of s) {
		const cw = displayWidth(ch);
		if (w + cw > width - 1) break;
		out += ch;
		w += cw;
	}
	return `${out}…`;
};

const fieldPlain = (f: Field): string =>
	f.segments
		.map((s) => sanitizePackText(s.text))
		.filter((t) => t !== "")
		.join(" ");

const rowPlainWidth = (cells: readonly Field[], sepGlyph: string): number =>
	displayWidth(cells.map(fieldPlain).join(` ${sepGlyph} `));

/**
 * Truncate a field's value to `budget` columns. The model field keeps its protected tail — the context-window
 * size `(1M)` and the effort — intact and ellipsizes only the model name, so those never vanish under width
 * pressure; every other field truncates from the end.
 */
const truncateField = (f: Field, budget: number): Field => {
	const tail = f.segments[f.segments.length - 1];
	if (f.id === "model" && f.segments.length >= 2 && tail !== undefined) {
		const tailText = sanitizePackText(tail.text);
		const headText = f.segments
			.slice(0, -1)
			.map((s) => sanitizePackText(s.text))
			.filter((t) => t !== "")
			.join(" ");
		const headBudget = Math.max(1, budget - displayWidth(tailText) - 1);
		return {
			id: f.id,
			segments: [
				{ role: "value", text: truncToWidth(headText, headBudget) },
				{ role: "value", text: tailText },
			],
		};
	}
	return { id: f.id, segments: [{ role: "value", text: truncToWidth(fieldPlain(f), budget) }] };
};

/** Drop the lowest-priority cells (per the row's drop order) until the row fits, then truncate the last value. */
const fitRow = (row: RowId, cells: readonly Field[], avail: number, sepGlyph: string): Field[] => {
	const present = [...cells];
	for (const id of dropOrder(row)) {
		if (rowPlainWidth(present, sepGlyph) <= avail) break;
		if (isProtected(id)) continue; // never remove a protected field; only its last value truncates (below)
		const idx = present.findIndex((c) => c.id === id);
		if (idx >= 0) present.splice(idx, 1);
	}
	if (rowPlainWidth(present, sepGlyph) <= avail) return present;

	const last = present[present.length - 1];
	if (last === undefined) return present;
	const head = present.slice(0, -1);
	const headWidth =
		head.length > 0 ?
			displayWidth(head.map(fieldPlain).join(` ${sepGlyph} `)) + displayWidth(` ${sepGlyph} `)
		:	0;
	const budget = Math.max(1, avail - headWidth);
	return [...head, truncateField(last, budget)];
};

const colorCell = (
	field: Field,
	lineIdx: number,
	cellIdx: number,
	input: LayoutInput,
	term: TermContext,
): string => {
	const { theme, moodShift, mood } = input;
	const s = theme.statusline;
	const tint = (color: number): number => (moodShift ? applyMood(color, mood, false) : color);
	const parts: string[] = [];
	for (const seg of field.segments) {
		const text = sanitizePackText(seg.text);
		if (text === "") continue;
		let color: number;
		if (seg.signal !== undefined) color = signalColor(s, seg.signal);
		else if (seg.role === "placeholder" || seg.role === "separator") color = s.separator;
		else if (seg.role === "value") color = tint(valueColor(s, lineIdx, cellIdx));
		else color = tint(accentColor(s, lineIdx, cellIdx));
		// A segment carrying an href (e.g. the PR field's `#n` from payload `pr.url`) becomes a clickable OSC 8
		// hyperlink with a dotted-underline affordance (fgLink); osc8 sanitizes the URL and no-ops under
		// NO_COLOR / a non-TTY. The cold-start placeholder is rendered faint (static dim) so a pending value
		// reads as transient without a blink; every other segment uses the solid foreground.
		let colored: string;
		if (seg.href !== undefined && seg.href !== "") {
			colored = osc8(seg.href, fgLink(color, text, term), term);
		} else if (seg.role === "placeholder") {
			colored = fgFaint(color, text, term);
		} else {
			colored = fg(color, text, term);
		}
		parts.push(colored);
	}
	return parts.join(" ");
};

const colorRow = (
	cells: readonly Field[],
	lineIdx: number,
	input: LayoutInput,
	term: TermContext,
	sepGlyph: string,
): string => {
	const sep = fg(input.theme.statusline.separator, sepGlyph, term);
	return cells.map((f, i) => colorCell(f, lineIdx, i, input, term)).join(` ${sep} `);
};

/** Build the helpful section row (`<emoji> <text>`): a fixed bold color; the severity emoji carries urgency. */
const helpfulRow = (input: LayoutInput, term: TermContext, width: number): string | null => {
	const h = input.helpful;
	if (h === null) return null;
	const style = helpfulStyle(h.severity);
	const emojiW = displayWidth(style.emoji);
	const text = truncToWidth(sanitizePackText(h.text), Math.max(1, width - emojiW - 1));
	return `${style.emoji} ${fgBold(style.color, text, term)}`;
};

/** Build the character section row (`<emblem> <gradient text>`), sanitized before colorize. */
const characterRow = (input: LayoutInput, term: TermContext, width: number): string | null => {
	const c = input.character;
	if (c === null) return null;
	const emblem = sanitizePackText(input.emblem);
	const emblemW = displayWidth(emblem);
	const text = truncToWidth(sanitizePackText(c.text), Math.max(1, width - emblemW - 1));
	const chars = Array.from(text);
	const stops = gradient(input.theme.comment.gradient, chars.length);
	const fallback = input.theme.comment.gradient[0] ?? 0;
	const tint = (color: number): number =>
		input.moodShift ? applyMood(color, input.mood, false) : color;
	let body = "";
	chars.forEach((ch, i) => {
		body += fg(tint(stops[i] ?? stops[0] ?? fallback), ch, term);
	});
	const emblemColor = tint(stops[0] ?? fallback);
	return `${fg(emblemColor, emblem, term)} ${body}`;
};

/** The colored `[<name>] │ ` chip that leads the statusline when the figure is dropped. */
const chip = (input: LayoutInput, term: TermContext): { text: string; width: number } => {
	// Render the pack slug as words: a hyphenated name (e.g. `harry-potter`) reads as `harry potter`
	// rather than breaking awkwardly at the hyphen when the chip is width-truncated.
	const name = sanitizePackText(input.name).replace(/-/g, " ");
	const label = `[${name}]`;
	const text = `${fg(accentColor(input.theme.statusline, 0), label, term)} ${fg(input.theme.statusline.separator, SEP_GLYPH, term)} `;
	return { text, width: displayWidth(label) + 1 + displayWidth(SEP_GLYPH) + 1 };
};

/** The colored provider badge (e.g. `🔑 api | `) that leads the model row; empty when no badge is present. */
const badgePrefix = (
	input: LayoutInput,
	lineIdx: number,
	term: TermContext,
): { text: string; width: number } => {
	const segs = input.providerBadge;
	if (segs === null) return { text: "", width: 0 };
	const text = colorCell({ id: "model", segments: segs }, lineIdx, 0, input, term);
	return { text, width: displayWidth(stripAnsi(text)) };
};

const LOCATION_IDS = new Set<string>(["dir", "added_dirs", "session_name"]);

/**
 * Within the identity row, a promoted git_branch (the lone-branch case) sits right after the
 * dir/added_dirs/session_name cluster and before the model, rather than trailing the row. Other rows are
 * untouched.
 */
const orderRow = (row: RowId, cells: Field[]): Field[] => {
	if (row !== 1) return cells;
	const bIdx = cells.findIndex((c) => c.id === "git_branch");
	const branch = cells[bIdx];
	if (branch === undefined) return cells;
	const rest = cells.filter((_, i) => i !== bIdx);
	let at = 0;
	while (at < rest.length && LOCATION_IDS.has(rest[at]?.id ?? "")) at++;
	return [...rest.slice(0, at), branch, ...rest.slice(at)];
};

/** Render the statusline section: the configured rows, fitted to `rw`, with the chip on the first row if dropped. */
const statuslineRows = (input: LayoutInput, term: TermContext, rw: number): string[] => {
	const sepGlyph = SEP_GLYPH;
	const out: string[] = [];
	const lead = input.dropped && input.showChip;
	const c = lead ? chip(input, term) : { text: "", width: 0 };
	let leadDone = false;
	let lineIdx = 0;
	// Effective rows are responsive to which fields actually rendered (e.g. a lone git_branch promotes to row 1).
	const presentIds = new Set(input.fields.map((f) => f.id));
	for (const row of [1, 2, 3, 4, 5] as const) {
		const cells = orderRow(
			row,
			input.fields.filter((f) => rowFor(f.id, presentIds) === row),
		);
		if (cells.length === 0) continue;
		const isLead = lead && !leadDone;
		// The provider badge leads the identity row (row 1), where the model now sits.
		const badge = row === 1 ? badgePrefix(input, lineIdx, term) : { text: "", width: 0 };
		const avail = Math.max(1, rw - (isLead ? c.width : 0) - badge.width);
		const fitted = fitRow(row, cells, avail, sepGlyph);
		const line = colorRow(fitted, lineIdx, input, term, sepGlyph);
		const prefix = (isLead ? c.text : "") + badge.text;
		out.push(prefix + line);
		leadDone = true;
		lineIdx++;
	}
	if (lead && !leadDone) out.push(rtrim(c.text)); // no fields: the chip still marks identity
	return out;
};

/**
 * The right-column text block, top→bottom: an optional helpful comment then a blank, the statusline rows, then a
 * blank and the optional character comment. No blank leads or trails the block — the inter-section blanks are the
 * helpful's trailing blank and the character's leading blank, so the block height is exactly
 * (helpful ? 2 : 0) + statuslineRows + (character ? 2 : 0), at most 9 (2 + 5 + 2).
 */
const rightColumn = (input: LayoutInput, term: TermContext, rw: number): string[] => {
	const rows: string[] = [];
	const h = helpfulRow(input, term, rw);
	if (h !== null) rows.push(h, "");
	rows.push(...statuslineRows(input, term, rw));
	const ch = characterRow(input, term, rw);
	if (ch !== null) rows.push("", ch);
	return rows;
};

const isBlankRow = (row: string): boolean =>
	Array.from(row).every((ch) => ch === " " || ch === "⠀");

/**
 * Trim fully-blank leading/trailing rows so the logo is only as tall as its art. Pack frames are stored as a
 * fixed 9-row box with blank padding rows; dropping that padding lets the logo shrink below 9 and centers cleanly
 * against the text block (no forced blank line at the top). Interior blank rows are kept.
 */
const trimFrame = (frame: readonly string[]): readonly string[] => {
	let start = 0;
	let end = frame.length;
	while (start < end && isBlankRow(frame[start] ?? "")) start++;
	while (end > start && isBlankRow(frame[end - 1] ?? "")) end--;
	return frame.slice(start, end);
};

const figureRows = (frame: readonly string[], input: LayoutInput, term: TermContext): string[] => {
	const { hues } = input.figure;
	const h = frame.length;
	const w = frame.reduce((m, row) => Math.max(m, Array.from(row).length), 1);
	// Center the figure block within FIGURE_COLS; an odd remainder goes to the right.
	const leftPad = Math.max(0, Math.floor((FIGURE_COLS - w) / 2));
	const rows: string[] = [];
	for (let i = 0; i < h; i++) {
		const raw = frame[i] ?? "";
		const chars = Array.from(raw);
		let line = "⠀".repeat(leftPad);
		chars.forEach((ch, x) => {
			if (ch === " " || ch === "⠀") {
				line += "⠀"; // blank cell: emit the braille blank (U+2800), so an ASCII-space-padded pack can't skew the row
				return;
			}
			line += fg(
				figureColor(hues, x, i, w, h, input.mood, input.now, input.moodShift),
				ch,
				term,
			);
		});
		const rightPad = FIGURE_COLS - leftPad - displayWidth(raw);
		if (rightPad > 0) line += "⠀".repeat(rightPad); // braille-blank pad (U+2800), never ASCII space
		rows.push(line);
	}
	return rows;
};

/**
 * Compose the figure and right column into one multi-line block. The figure is trimmed
 * to its art height (its stored blank padding rows are dropped), then the logo and the text block are each
 * vertically centered within the taller of the two, so the logo sits level with the text's middle and neither
 * starts on a forced blank row; the odd leftover row skews to the bottom. When the content block is under the
 * 9-row budget, one braille-blank gap row is appended so the last line does not sit on the final row.
 * When the figure is dropped (too narrow / pack failed to load) the right column takes the full width, the
 * statusline leads with the `[<name>]` chip, and the section-separator blanks (plus the bottom gap) are emitted as
 * braille-blank so the host's empty-line strip keeps them. Every escape is stripped under NO_COLOR or a non-TTY.
 */
export const layout = (input: LayoutInput, term: TermContext): string => {
	if (input.dropped) {
		const right = rightColumn(input, term, term.columns);
		// No figure column to hold the gutter, so a blank separator row is emitted as a single braille-blank
		// (U+2800): invisible but not whitespace, so the host's empty-line strip keeps the section spacing.
		const rows = right.map((r) => rtrim(r)).map((r) => (r === "" ? "⠀" : r));
		// The text block is always the taller side here (no figure); a bottom gap keeps it off the last row.
		if (right.length > 0 && right.length < FIGURE_ROWS) rows.push("⠀");
		return rows.join("\n");
	}

	const rw = Math.max(MIN_RIGHT_WIDTH, term.columns - (FIGURE_COLS + GAP));
	const right = rightColumn(input, term, rw);
	const fig = figureRows(trimFrame(input.frame), input, term);

	// Bottom gap: one extra row whenever the content block is under the 9-row budget, so the last line never sits
	// on the final row. The gap is folded into the canvas height, so both columns center against the whole block
	// and gain a top space matching the bottom gap; at the full 9 rows there is no room and no gap.
	const base = Math.max(fig.length, right.length);
	const gap = base < FIGURE_ROWS ? 1 : 0;
	const total = base + gap;
	// Center both columns within the taller of the two, so the logo sits level with the text block's middle; the
	// odd leftover row skews to the bottom (floor at the top).
	const figStart = Math.floor((total - fig.length) / 2);
	const rightStart = Math.floor((total - right.length) / 2);
	// The figure-column filler for rows the centered art does not cover is braille-blank (U+2800), never ASCII
	// space: the host statusline strips leading ASCII whitespace and drops all-whitespace lines, which would yank
	// the comment rows (helpful/character) to column 0 and delete the blank separator rows. Braille-blank is not
	// whitespace, so it holds the gutter width — keeping the comments aligned under the statusline and every
	// separator (and the bottom gap) row non-empty.
	const blank = "⠀".repeat(FIGURE_COLS);
	const out: string[] = [];
	for (let i = 0; i < total; i++) {
		const left = i >= figStart ? (fig[i - figStart] ?? blank) : blank;
		const rightLine = i >= rightStart ? (right[i - rightStart] ?? "") : "";
		out.push(rtrim(`${left}${" ".repeat(GAP)}${rightLine}`));
	}
	return out.join("\n");
};

export { stripAnsi };
