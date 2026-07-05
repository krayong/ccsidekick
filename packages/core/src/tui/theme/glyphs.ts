// TUI chrome glyphs. A Unicode set by default, with an ASCII fallback for terminals or users that prefer plain
// symbols. Marker and its blank counterpart are one column wide so a selected row does not shift.

export interface GlyphSet {
	readonly marker: string;
	readonly markerBlank: string;
	readonly vRule: string;
	readonly tabActive: string;
	readonly tabInactive: string;
	readonly commandKey: string;
	readonly ellipsis: string;
}

const UNICODE: GlyphSet = {
	marker: "❯",
	markerBlank: " ",
	vRule: "│",
	tabActive: "●",
	tabInactive: "○",
	commandKey: "⌘",
	ellipsis: "…",
};

const ASCII: GlyphSet = {
	marker: ">",
	markerBlank: " ",
	vRule: "|",
	tabActive: "*",
	tabInactive: "-",
	commandKey: "^P",
	ellipsis: "...",
};

export function glyphSet(asciiOnly: boolean): GlyphSet {
	return asciiOnly ? ASCII : UNICODE;
}
