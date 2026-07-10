// xterm-256 palette index -> #rrggbb. Shared source of truth for the site data generator and any other
// script that needs to resolve a theme's palette indices to hex (kept in one place to avoid drift).

const STD = [
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
] as const;
const LEVELS = [0, 95, 135, 175, 215, 255] as const;
const FALLBACK = "#8b949e";

/** Resolve an xterm-256 index (0-255) to a `#rrggbb` string. */
export function palette(n: number): string {
	if (n < 16) return STD[n] ?? FALLBACK;
	if (n < 232) {
		const c = n - 16;
		const r = LEVELS[Math.floor(c / 36) % 6] ?? 0;
		const g = LEVELS[Math.floor(c / 6) % 6] ?? 0;
		const b = LEVELS[c % 6] ?? 0;
		return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
	}
	const v = (8 + (n - 232) * 10).toString(16).padStart(2, "0");
	return `#${v}${v}${v}`;
}

/** Resolve a palette index to hex, or the muted fallback when the value isn't a number. */
export const paletteHex = (n: unknown): string => (typeof n === "number" ? palette(n) : FALLBACK);
