// ANSI SGR strip + display-width measurement. Pure: reads no env, takes only strings.
// Display width is wcwidth-aware: the double-width glyphs the specs emit (the severity emoji and the provider
// badge) plus East-Asian Wide / Fullwidth code points (CJK, kana, Hangul, fullwidth forms) count as 2; every
// other non-combining code point counts as 1 and combining marks / variation selectors / ZWJ count as 0.
// Shared by figure/layout/lint width checks.

// SGR includes the `:` sub-parameter form (e.g. `4:4` dotted underline), not just `;`-separated params.
// eslint-disable-next-line no-control-regex -- ESC (\x1b) is the literal SGR introducer being matched for stripping
const SGR = /\x1b\[[0-9;:]*m/g;
// The renderer's own OSC 8 hyperlink frames (`ESC ] 8 ; ; <url> BEL|ST`) are zero-width and stripped for
// display-width/plain-text purposes. Pack-injected OSC is neutralized earlier (sanitizePackText) and caught
// by the raw-byte injection assertions, so removing OSC 8 here does not weaken that guard.
// eslint-disable-next-line no-control-regex -- ESC/BEL control bytes are the literal OSC 8 framing being matched for stripping
const OSC8 = /\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

// Single-code-point emoji that always render double-width: severity + provider badge glyphs and the statusline
// field icons that carry their own emoji presentation without a selector.
const WIDE_ALWAYS = new Set([
	"🚨",
	"💡",
	"💬",
	"🔑",
	"🪨",
	"🏭",
	"🔀",
	"👥",
	"🏢",
	"🦇",
	"📁",
	"📂",
	"🪧",
	"🌿",
	"🔖",
	"🌳",
	"🔗",
	"⚡",
	"🧠",
	"🤖",
	"📊",
	"🧾",
	"🏦",
	"📈",
	"📅",
	"💳",
	"💸",
	"🎯",
	"🔥",
	"⏳",
	"📝",
	"🌀",
	"🤝",
	"🍒",
	"🔙",
	"💅",
	"✨",
	"☕",
]);
// Bases that render single-width as text but double-width when an emoji variation selector (U+FE0F) follows:
// the severity/badge bases (⚠️ ☁️ ⚙️) and the statusline field icons whose base is text-default
// (🏷️ 🗄️ ✍️ 🗜️ 🏗️ ⏱️). The text selector U+FE0E keeps them single-width.
const WIDE_WITH_FE0F = new Set(["⚠", "☁", "⚙", "🏷", "🗄", "✍", "🗜", "🏗", "⏱", "❄"]);

const isZeroWidth = (ch: string): boolean => {
	const cp = ch.codePointAt(0) ?? 0;
	if (cp === 0x200d) return true; // zero-width joiner
	if (cp >= 0xfe00 && cp <= 0xfe0f) return true; // variation selectors
	return /\p{M}/u.test(ch); // combining marks
};

// East-Asian Wide / Fullwidth code points (wcwidth-style): single code points a terminal renders in two columns.
// Covers the common CJK/kana/Hangul blocks and the fullwidth forms; pictographic emoji are handled by the
// per-glyph sets above, so the emoji planes are intentionally left out here.
const isWideEastAsian = (cp: number): boolean =>
	(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
	(cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals … CJK Symbols & Punctuation
	(cp >= 0x3041 && cp <= 0x33ff) || // Hiragana / Katakana … CJK Compatibility (wide kana, etc.)
	(cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Ext A
	(cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
	(cp >= 0xa000 && cp <= 0xa4cf) || // Yi Syllables & Radicals
	(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
	(cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
	(cp >= 0xfe10 && cp <= 0xfe19) || // Vertical Forms
	(cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms … Small Form Variants
	(cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
	(cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
	(cp >= 0x20000 && cp <= 0x3fffd); // CJK Unified Ideographs Ext B … supplementary ideographic plane

export const stripAnsi = (s: string): string => s.replace(SGR, "").replace(OSC8, "");

export const displayWidth = (s: string): number => {
	const cps = Array.from(stripAnsi(s)); // code-point split (avoids UTF-16 unit splitting)
	let w = 0;
	for (let i = 0; i < cps.length; i++) {
		const ch = cps[i] ?? "";
		if (isZeroWidth(ch)) continue;
		if (WIDE_ALWAYS.has(ch)) {
			w += 2;
			continue;
		}
		if (WIDE_WITH_FE0F.has(ch) && cps[i + 1] === "️") {
			w += 2;
			continue;
		}
		// Supplementary-plane pictographs (the emoji planes, U+1F000–U+1FAFF) render two columns by
		// default, so any pack emblem or field icon in this plane is wide without a per-glyph allowlist
		// entry. A trailing text selector (U+FE0E) forces the single-width presentation.
		const cp = ch.codePointAt(0) ?? 0;
		if (cp >= 0x1f000 && cp <= 0x1faff && cps[i + 1] !== "︎") {
			w += 2;
			continue;
		}
		if (isWideEastAsian(cp)) {
			w += 2;
			continue;
		}
		w += 1;
	}
	return w;
};

/** Right-pad `s` with spaces so its display width (wide glyphs = 2) reaches `width`; never truncates. */
export const padEndDisplay = (s: string, width: number): string => {
	const gap = width - displayWidth(s);
	return gap > 0 ? s + " ".repeat(gap) : s;
};

// Matches one SGR or OSC 8 escape sequence, the same framing `stripAnsi` strips — kept as a capturing
// group so `String.split` interleaves the sequences (odd indices) with the plain-text runs between them
// (even indices).
// eslint-disable-next-line no-control-regex -- ESC/BEL control bytes are the literal SGR/OSC 8 framing being matched, mirroring SGR/OSC8 above
const ANSI_TOKEN = /(\x1b\[[0-9;:]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\))/;

/**
 * Truncate an ANSI-colored string to `width` display columns, keeping every escape sequence intact (they
 * carry no display width) and appending a reset code if the cut lands inside a colored span — otherwise
 * the color would bleed into whatever the caller appends after the truncated text. Unlike a plain
 * character slice, this measures wide glyphs with the same table `displayWidth` uses, so truncation
 * lands on the same column a real terminal would.
 */
export const truncateAnsi = (s: string, width: number): string => {
	if (width <= 0) return "";
	if (displayWidth(s) <= width) return s;
	const parts = s.split(ANSI_TOKEN);
	let out = "";
	let w = 0;
	let truncated = false;
	let sawEscape = false;
	for (let i = 0; i < parts.length; i++) {
		if (truncated) break;
		const part = parts[i] ?? "";
		if (i % 2 === 1) {
			out += part; // an escape sequence: zero width, always kept while still copying
			sawEscape = true;
			continue;
		}
		for (const ch of part) {
			const cw = displayWidth(ch);
			if (w + cw > width) {
				truncated = true;
				break;
			}
			out += ch;
			w += cw;
		}
	}
	return truncated && sawEscape ? `${out}\x1b[0m` : out;
};
