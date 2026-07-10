// theme-options: render candidate ThemeData palettes for a pack as an HTML artifact.
// Usage: bun theme-options.ts <packDir> --candidates <candidates.json>
// Renders each candidate's logo (diagonal cyclic smoothstep gradient), a 5-row line-solid statusline mock,
// and the comment gradient so the pack author can pick one. Writes <packDir>/.author/themes.html.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	hexForXterm,
	rgbToXterm,
	themeColorErrors,
	xtermToRgb,
} from "../../../../packages/core/src";

// ── types ──────────────────────────────────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

interface Candidate {
	readonly name: string;
	readonly hues: readonly number[];
	readonly comment: readonly number[];
	readonly signals: {
		readonly nominal: number;
		readonly caution: number;
		readonly critical: number;
	};
	readonly separator: number;
}

// Minimal pack shape needed for the preview (independent of the full PackJson type).
interface Pack {
	readonly displayName: string;
	readonly emblem: string;
	readonly art: readonly string[];
	readonly lines: {
		readonly mood?: {
			readonly idle?: { readonly stranger?: readonly string[] };
		};
	};
}

// ── visibility gate ──────────────────────────────────────────────────────────────────────────────
// themeColorErrors is the shared color-visibility gate (render/themeValidate), the same one pack:lint runs.

function validateCandidate(c: Candidate): string[] {
	// Delegates to the engine's theme-color validator: bounds, visibility (no grey/near-black), and
	// signal hue families (nominal=green, caution=amber, critical=red). A candidate that passes
	// here will also pass pack:lint — the check is mechanically equivalent.
	return themeColorErrors(c, "theme");
}

// ── HTML helpers ──────────────────────────────────────────────────────────────────────────────────

const esc = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const span = (idx: number, s: string): string =>
	`<span style="color:${hexForXterm(idx)}">${esc(s)}</span>`;

// ── math helpers ───────────────────────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [
	lerp(a[0], b[0], t),
	lerp(a[1], b[1], t),
	lerp(a[2], b[2], t),
];
const smooth = (t: number): number => t * t * (3 - 2 * t);
const frac = (x: number): number => x - Math.floor(x);

// ── renderers ─────────────────────────────────────────────────────────────────────────────────────

const BRAILLE_BLANK = "⠀"; // U+2800 braille blank

/**
 * Diagonal cyclic smoothstep gradient. Static phase (preview snapshot, not animated).
 * W and H come from the actual frame extents, not hardcoded maximums.
 */
function renderLogo(frame: readonly string[], hues: readonly number[]): string {
	const H = frame.length;
	const W = Math.max(0, ...frame.map((r) => [...r].length));
	const lines: string[] = [];
	for (let y = 0; y < H; y++) {
		const cells = [...(frame[y] ?? "")];
		let line = "";
		for (let x = 0; x < W; x++) {
			const ch = cells[x] ?? BRAILLE_BLANK;
			if (ch === BRAILLE_BLANK || ch === " ") {
				line += " ";
				continue;
			}
			// Diagonal position t ∈ [0, 1): average of normalized x and y.
			const t = (x / Math.max(1, W - 1) + y / Math.max(1, H - 1)) / 2;
			const n = hues.length;
			const p = frac(t) * n;
			const i = Math.floor(p) % n;
			const c = mix(
				xtermToRgb(hues[i]!),
				xtermToRgb(hues[(i + 1) % n]!),
				smooth(p - Math.floor(p)),
			);
			line += span(rgbToXterm(c), ch);
		}
		lines.push(line);
	}
	return lines.join("\n");
}

/** Line-solid statusline mock (5 rows). Each row takes hues[row mod n]. */
function renderStatus(c: Candidate): string {
	const h = (i: number): number => c.hues[i % c.hues.length] ?? c.separator;
	const sep = span(c.separator, " │ ");
	const rows = [
		span(h(0), "◈ ~/acme/myproject") + sep + span(h(0), "↳ main"),
		span(c.signals.nominal, "+128") +
			" " +
			span(c.signals.critical, "-41") +
			" " +
			span(h(1), "6 files"),
		span(h(2), "Opus 4.8 (1M) ✦ high"),
		span(h(3), "§ Chat: $1.23") + sep + span(h(3), "Σ Total: $44.10"),
		span(h(4), "⬓ Context: ") +
			span(c.signals.caution, "42%") +
			sep +
			span(h(4), "◴ Block: ") +
			span(c.signals.nominal, "18%"),
	];
	return rows.join("\n");
}

/** Vivid comment gradient. */
function renderComment(emblem: string, text: string, stops: readonly number[]): string {
	const chars = [...text];
	const rgbs = stops.map(xtermToRgb);
	const colorAt = (f: number): number => {
		if (rgbs.length === 1) return stops[0] ?? 231;
		const p = f * (rgbs.length - 1);
		const i = Math.min(rgbs.length - 2, Math.floor(p));
		return rgbToXterm(mix(rgbs[i]!, rgbs[i + 1]!, p - i));
	};
	let out = span(stops[0] ?? 231, `${emblem} `);
	chars.forEach((ch, idx) => {
		out += span(colorAt(chars.length <= 1 ? 0 : idx / (chars.length - 1)), ch);
	});
	return out;
}

// ── public API ────────────────────────────────────────────────────────────────────────────────────

/** Render all candidates as a full HTML document for browser preview. */
export function themesHtml(pack: Pack, candidates: readonly Candidate[]): string {
	const sampleText = (
		pack.lines.mood?.idle?.stranger?.[0] ?? `${pack.displayName} observes. Waiting.`
	).slice(0, 46);

	const candidateBlocks = candidates
		.map((cand, idx) => {
			const errors = validateCandidate(cand);
			const header = `<h2 style="font-family:monospace;margin:0 0 4px">${esc(`${idx + 1}. ${cand.name}`)}</h2>`;
			if (errors.length > 0) {
				const errList = errors
					.map((e) => `<div style="color:#ff5f5f">✗ ${esc(e)}</div>`)
					.join("");
				return `<div style="margin:16px 0;padding:8px;background:#1a1a1a;border-left:3px solid #ff5f5f">
${header}
${errList}
<div style="color:#808080">(skipped — fix the indices above)</div>
</div>`;
			}
			const logo = renderLogo(pack.art, cand.hues).split("\n");
			const status = renderStatus(cand).split("\n");
			const combined = logo
				.map((logoRow, i) => {
					const statusRow = status[i - 2] ?? "";
					return logoRow + "   " + statusRow;
				})
				.join("\n");
			const comment = renderComment(pack.emblem, sampleText, cand.comment);
			const meta = esc(
				`hues ${JSON.stringify(cand.hues)}  comment ${JSON.stringify(cand.comment)}  sep ${cand.separator}`,
			);
			return `<div style="margin:16px 0;padding:8px;background:#1a1a1a">
${header}
<div style="font-family:monospace;font-size:11px;color:#808080;margin-bottom:8px">${meta}</div>
<pre style="font-family:monospace;line-height:1.1;margin:0 0 8px;white-space:pre">${combined}

   ${comment}</pre>
</div>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Theme options — ${esc(pack.displayName)}</title>
<style>body{background:#0d0d0d;color:#d0d0d0;padding:16px;}</style>
</head>
<body>
<h1 style="font-family:monospace">${esc(pack.displayName)} — theme candidates</h1>
${candidateBlocks}
</body>
</html>
`;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const candidatesIdx = argv.indexOf("--candidates");
	const candidatesPath = candidatesIdx >= 0 ? argv[candidatesIdx + 1] : undefined;
	// The positional packDir is the first non-flag token that is not the --candidates value.
	const packDir = argv.find((a, i) => !a.startsWith("--") && i !== candidatesIdx + 1);

	if (
		packDir === undefined ||
		packDir === "" ||
		candidatesPath === undefined ||
		candidatesPath === ""
	) {
		process.stderr.write(
			"usage: theme-options.ts <packDir> --candidates <candidates.json>\n" +
				"  packDir:    path to a pack directory containing pack.json\n" +
				"  candidates: JSON file — array of ThemeData candidates\n" +
				"              each: { name, hues: number[4-5], comment: number[2-3],\n" +
				"                       signals: {nominal,caution,critical}, separator }\n",
		);
		process.exit(2);
	}

	const pack: Pack = JSON.parse(readFileSync(join(packDir, "pack.json"), "utf8")) as Pack;
	const candidates: Candidate[] = JSON.parse(readFileSync(candidatesPath, "utf8")) as Candidate[];

	const outDir = join(packDir, ".author");
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "themes.html"), themesHtml(pack, candidates), "utf8");
	process.stdout.write(
		`theme-options: wrote ${join(outDir, "themes.html")} — open it and pick a candidate.\n`,
	);
}
