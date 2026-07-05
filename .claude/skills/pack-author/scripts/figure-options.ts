// figure-options: render candidate ASCII figures for a pack as an HTML artifact.
// Usage: bun figure-options.ts <packDir> --candidates <candidates.json>
// Validates each figure (≤9 rows, each row displayWidth ≤ 25) and writes <packDir>/.author/figures.html.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { displayWidth } from "../../../../packages/core/src";

// ── types ──────────────────────────────────────────────────────────────────────────────────────────

interface FigureCandidate {
	readonly name: string;
	readonly rows: readonly string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function validateFigure(cand: FigureCandidate): string[] {
	const errors: string[] = [];
	if (cand.rows.length > 9) {
		errors.push(`too many rows: ${cand.rows.length} (max 9)`);
	}
	for (const [i, row] of cand.rows.entries()) {
		const w = displayWidth(row);
		if (w > 25) {
			errors.push(`row ${i} is ${w} columns wide (max 25): ${row}`);
		}
	}
	return errors;
}

// ── public API ────────────────────────────────────────────────────────────────────────────────────

/** Render all figure candidates as a full HTML document for browser preview. */
export function figuresHtml(cands: readonly FigureCandidate[]): string {
	const blocks = cands
		.map((cand, idx) => {
			const errors = validateFigure(cand);
			const maxW = Math.max(0, ...cand.rows.map((r) => displayWidth(r)));
			const dims = `${cand.rows.length}×${maxW}`;
			const header = `<h2 style="font-family:monospace;margin:0 0 4px">${esc(`${idx + 1}. ${cand.name}`)} <span style="color:#808080;font-size:11px">${esc(dims)}</span></h2>`;
			if (errors.length > 0) {
				const errList = errors
					.map((e) => `<div style="color:#ff5f5f">✗ ${esc(e)}</div>`)
					.join("");
				return `<div style="margin:16px 0;padding:8px;background:#1a1a1a;border-left:3px solid #ff5f5f">
${header}
${errList}
</div>`;
			}
			const preContent = cand.rows.map(esc).join("\n");
			return `<div style="margin:16px 0;padding:8px;background:#1a1a1a">
${header}
<pre style="font-family:monospace;line-height:1.1;margin:0;white-space:pre">${preContent}</pre>
</div>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Figure options</title>
<style>body{background:#0d0d0d;color:#d0d0d0;padding:16px;}</style>
</head>
<body>
<h1 style="font-family:monospace">Figure candidates</h1>
${blocks}
</body>
</html>
`;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const candidatesIdx = argv.indexOf("--candidates");
	const candidatesPath = candidatesIdx >= 0 ? argv[candidatesIdx + 1] : undefined;
	const packDir = argv.find((a, i) => !a.startsWith("--") && i !== candidatesIdx + 1);

	if (
		packDir === undefined ||
		packDir === "" ||
		candidatesPath === undefined ||
		candidatesPath === ""
	) {
		process.stderr.write(
			"usage: figure-options.ts <packDir> --candidates <candidates.json>\n" +
				"  packDir:    path to a pack directory containing pack.json\n" +
				"  candidates: JSON file — array of figure candidates\n" +
				"              each: { name: string, rows: string[] }\n",
		);
		process.exit(2);
	}

	const cands: FigureCandidate[] = JSON.parse(
		readFileSync(candidatesPath, "utf8"),
	) as FigureCandidate[];

	const outDir = join(packDir, ".author");
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "figures.html"), figuresHtml(cands), "utf8");
	process.stdout.write(
		`figure-options: wrote ${join(outDir, "figures.html")} — open it and pick a figure.\n`,
	);
}
