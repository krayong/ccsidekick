#!/usr/bin/env node
// Render the statusline's real ANSI output (read from stdin) into a faithful SVG "terminal shot" for the README.
// Handles 256-color SGR (`\x1b[38;5;Nm`), OSC 8 hyperlinks, and double-width emoji on a fixed character grid.
// Usage: ccsidekick-render render < payload.json | node scripts/assets/statusline-svg.mjs "Title" > assets/statusline.svg

const FONT_SIZE = 14;
const CELL_W = 8.4; // monospace advance per single-width column
const LINE_H = 18;
const PAD = 18;
const TITLEBAR = 30;
const BG = "#0d1117";
const TITLEBAR_BG = "#161b22";
const DEFAULT_FG = "#c9d1d9";
const DOTS = ["#ff5f56", "#ffbd2e", "#27c93f"];

// Mirror the engine's display-width rules (render/strip.ts) so the SVG grid lands on the same columns the
// renderer laid out. Emoji that are always double-width, and text-default bases that widen when U+FE0F follows.
const WIDE_ALWAYS = new Set([
	..."🚨💡💬🔑🪨🏭🔀👥🏢🦇📁📂🪧🌿🔖🌳🔗⚡🧠🤖📊🧾🏦📈📅💳💸🎯🔥⏳📝🌀🤝🍒🔙💅✨☕",
]);
const WIDE_WITH_FE0F = new Set(["⚠", "☁", "⚙", "🏷", "🗄", "✍", "🗜", "🏗", "⏱", "❄"]);
// Zero-width: ZWJ, variation selectors, combining marks — they attach to the preceding glyph, never a new cell.
const isZeroWidth = (cp) =>
	cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || /\p{M}/u.test(String.fromCodePoint(cp));

/** xterm-256 palette index → #rrggbb. */
function palette(n) {
	const std = [
		"#000000",
		"#cd0000",
		"#00cd00",
		"#cdcd00",
		"#0000ee",
		"#cd00cd",
		"#00cdcd",
		"#e5e5e5",
		"#7f7f7f",
		"#ff0000",
		"#00ff00",
		"#ffff00",
		"#5c5cff",
		"#ff00ff",
		"#00ffff",
		"#ffffff",
	];
	if (n < 16) return std[n];
	if (n < 232) {
		const c = n - 16;
		const lv = [0, 95, 135, 175, 215, 255];
		const r = lv[Math.floor(c / 36) % 6];
		const g = lv[Math.floor(c / 6) % 6];
		const b = lv[c % 6];
		return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
	}
	const v = (8 + (n - 232) * 10).toString(16).padStart(2, "0");
	return `#${v}${v}${v}`;
}

/** Apply an SGR parameter list (already split on ';') to the current fg, returning the new fg. */
function applySGR(params, fg) {
	if (params === "" || params === "0") return DEFAULT_FG;
	const t = params.split(";");
	for (let k = 0; k < t.length; k++) {
		if (t[k] === "0") fg = DEFAULT_FG;
		else if (t[k] === "38" && t[k + 1] === "5") {
			fg = palette(Number(t[k + 2]));
			k += 2;
		}
	}
	return fg;
}

function xml(s) {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function parse(input) {
	const cells = [];
	let fg = DEFAULT_FG;
	let href = null;
	let col = 0;
	let row = 0;
	let maxCol = 0;
	let i = 0;
	while (i < input.length) {
		const c = input[i];
		if (c === "\x1b" && input[i + 1] === "[") {
			let j = i + 2;
			while (j < input.length && !/[A-Za-z]/.test(input[j])) j++;
			if (input[j] === "m") fg = applySGR(input.slice(i + 2, j), fg);
			i = j + 1;
			continue;
		}
		if (c === "\x1b" && input[i + 1] === "]") {
			let j = i + 2;
			while (
				j < input.length &&
				input[j] !== "\x07" &&
				!(input[j] === "\x1b" && input[j + 1] === "\\")
			)
				j++;
			const body = input.slice(i + 2, j);
			const m = /^8;;(.*)$/.exec(body);
			if (m) href = m[1] === "" ? null : m[1];
			i = input[j] === "\x07" ? j + 1 : j + 2;
			continue;
		}
		if (c === "\n") {
			if (col > maxCol) maxCol = col;
			row++;
			col = 0;
			i++;
			continue;
		}
		const cp = input.codePointAt(i);
		const ch = String.fromCodePoint(cp);
		if (isZeroWidth(cp)) {
			const last = cells[cells.length - 1];
			if (last !== undefined && last.row === row) last.ch += ch;
			i += ch.length;
			continue;
		}
		const w =
			(
				WIDE_ALWAYS.has(ch) ||
				(WIDE_WITH_FE0F.has(ch) && input.codePointAt(i + ch.length) === 0xfe0f) ||
				// Supplementary-plane pictographs render two columns by default (matches render/strip.ts),
				// so any emoji emblem is wide without a per-glyph allowlist entry; U+FE0E forces text width.
				(cp >= 0x1f000 && cp <= 0x1faff && input.codePointAt(i + ch.length) !== 0xfe0e)
			) ?
				2
			:	1;
		if (ch !== " " && cp !== 0x2800) cells.push({ ch, col, row, fg, href });
		col += w;
		i += ch.length;
	}
	if (col > maxCol) maxCol = col;
	return { cells, cols: maxCol, rows: row + (col > 0 ? 1 : 0) };
}

function svg(input, title) {
	const { cells, cols, rows } = parse(input);
	const W = Math.ceil(PAD * 2 + cols * CELL_W);
	const H = Math.ceil(TITLEBAR + PAD + rows * LINE_H + PAD);
	const out = [];
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="${FONT_SIZE}">`,
	);
	out.push(`<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`);
	out.push(
		`<path d="M0 ${TITLEBAR} V10 a10 10 0 0 1 10 -10 H${W - 10} a10 10 0 0 1 10 10 V${TITLEBAR} Z" fill="${TITLEBAR_BG}"/>`,
	);
	DOTS.forEach((d, k) =>
		out.push(`<circle cx="${18 + k * 18}" cy="${TITLEBAR / 2}" r="5.5" fill="${d}"/>`),
	);
	if (title)
		out.push(
			`<text x="${W / 2}" y="${TITLEBAR / 2 + 4}" text-anchor="middle" fill="#8b949e" font-size="12">${xml(title)}</text>`,
		);
	for (const { ch, col, row, fg, href } of cells) {
		const x = (PAD + col * CELL_W).toFixed(1);
		const y = (TITLEBAR + PAD + (row + 0.8) * LINE_H).toFixed(1);
		const text = `<text x="${x}" y="${y}" fill="${fg}">${xml(ch)}</text>`;
		out.push(href ? `<a xlink:href="${xml(href)}">${text}</a>` : text);
	}
	out.push("</svg>");
	return out.join("\n");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => process.stdout.write(svg(buf, process.argv[2] ?? "") + "\n"));
