// `pack:lint`: the pack authoring gate, runnable as a CLI and importable as `lintPack`. It first narrows the raw
// JSON through the schema guard (`validatePackDetailed`); on a schema failure it short-circuits. Two checks run
// in every mode (schema-only included): the figure legibility gate and the schema guard's own bounds/width/
// theme/colorMap/attribution checks. Four further CONTENT gates run only in full mode: pool counts, character-
// line width, the spinner-verb floor, and the per-leaf-cell near-duplicate gate. `--schema-only` runs the schema
// and legibility gates; full lint adds the content gates. CI may run `--schema-only` for a pack whose voice
// library is still being filled in.
//
// lint consumes the already-validated, fully typed `PackJson` from `validate`, so it never touches loose JSON
// (no `no-unsafe-*` carve-out here); only the CLI's `JSON.parse` boundary handles `unknown`. Beyond pack.json,
// the CLI also runs `packageJsonErrors` on the sibling package.json (publish-metadata completeness), in both
// modes since that is structural, not voice content; `lintPack` itself stays path-less and pack.json-only.

import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	CHAR_LINE_MAX,
	CROSS_CELL_JACCARD,
	JACCARD_DUP,
	type PackJson,
	type PackLines,
	POOL_TOTAL,
	SPINNER_VERB_MIN,
} from "../domain";
import { displayWidth, stripAnsi, themeColorErrors } from "../render";

import { jaccard, tokenSet } from "./jaccard";
import { expectedCount, LEAF_PATHS } from "./poolShape";
import { validatePackDetailed } from "./validate";

// A reserved sentinel the scaffold stamps into every placeholder line: the single Private Use Area code point
// U+E000, which authored prose never contains, so the gate has no false positives. Written as an escape so it is
// visible in source and survives copy/paste; a bare literal would render blank and silently degrade to "".
export const PLACEHOLDER_TOKEN = "\uE000";

// Max fraction of a frame's cells that may be inked glyphs. Both U+0020 (space) and U+2800 (blank braille) count
// as EMPTY: they render as blank, and braille art legitimately pads with U+2800 so every cell is a uniform-width
// braille glyph (mixing in ASCII spaces skews the figure in some fonts). Density measures visible ink only.
const FIGURE_DENSITY_MAX = 0.85;

interface LintResult {
	readonly ok: boolean;
	readonly errors: string[];
}

interface LeafCell {
	readonly path: string;
	readonly lines: readonly string[];
}

type Record1 = Readonly<Record<string, readonly string[]>>;
type Record2 = Readonly<Record<string, Record1>>;

// Each `lines` leaf array, plus `dateEgg` and `spinnerVerbs`, as a labeled cell for the near-duplicate gate.
function leafCells(lines: PackLines, spinnerVerbs: readonly string[]): LeafCell[] {
	const cells: LeafCell[] = [];
	const push2 = (name: string, r: Record2): void => {
		for (const [a, inner] of Object.entries(r))
			for (const [b, arr] of Object.entries(inner))
				cells.push({ path: `${name}.${a}.${b}`, lines: arr });
	};
	const push1 = (name: string, r: Record1): void => {
		for (const [a, arr] of Object.entries(r)) cells.push({ path: `${name}.${a}`, lines: arr });
	};
	push2("mood", lines.mood);
	push2("greeting", lines.greeting);
	push2("milestone", lines.milestone);
	push2("positiveGit", lines.positiveGit);
	push2("stack", lines.stack);
	push1("firstContact", lines.firstContact);
	push1("egg", lines.egg);
	push1("event", lines.event);
	push1("pressure", lines.pressure);
	cells.push({ path: "dateEgg", lines: lines.dateEgg });
	cells.push({ path: "spinnerVerbs", lines: spinnerVerbs });
	return cells;
}

// Figure legibility: reject a figure whose inked-glyph density exceeds FIGURE_DENSITY_MAX. Counts code points;
// U+0020 (space) and U+2800 (blank braille) render blank and count as EMPTY; every other code point is ink.
function checkLegibility(art: PackJson["art"], errors: string[]): void {
	let cells = 0;
	let filled = 0;
	for (const row of art)
		for (const ch of Array.from(row)) {
			cells++;
			if (ch !== " " && ch !== "⠀") filled++;
		}
	if (cells === 0) return;
	const density = filled / cells;
	if (density > FIGURE_DENSITY_MAX)
		errors.push(
			`art is too dense: ${density.toFixed(2)} > ${String(FIGURE_DENSITY_MAX)} non-space glyph ratio`,
		);
}

// Gate 1: per-cell pool counts, over the canonical LEAF_PATHS. A cell that is present but skewed (50 idle lines
// all under one tier) AND a cell missing entirely both report per-cell against their expected count; the grand
// total must equal POOL_TOTAL. spinnerVerbs has a floor, not a count (Gate 3), and is absent from LEAF_PATHS.
function checkPoolCounts(cells: readonly LeafCell[], errors: string[]): void {
	const actual = new Map(cells.map((c) => [c.path, c.lines.length]));
	let total = 0;
	for (const path of LEAF_PATHS) {
		const n = actual.get(path) ?? 0;
		total += n;
		const expected = expectedCount(path);
		if (n !== expected)
			errors.push(`lines.${path} has ${String(n)} line(s), expected ${String(expected)}`);
	}
	if (total !== POOL_TOTAL)
		errors.push(`pool counts total ${String(total)} line(s), expected ${String(POOL_TOTAL)}`);
}

// Gate 2: every character line within CHAR_LINE_MAX display columns (ANSI-stripped).
function checkLineWidth(cells: readonly LeafCell[], errors: string[]): void {
	for (const cell of cells) {
		if (cell.path === "spinnerVerbs") continue; // spinner verbs are not character lines
		for (const line of cell.lines) {
			const w = displayWidth(line);
			if (w > CHAR_LINE_MAX)
				errors.push(
					`lines.${cell.path} has a line of ${String(w)} columns, exceeds ${String(CHAR_LINE_MAX)}: "${stripAnsi(line).slice(0, 40)}"`,
				);
		}
	}
}

// Gate 3: spinner-verb floor.
function checkSpinnerVerbs(spinnerVerbs: readonly string[], errors: string[]): void {
	if (spinnerVerbs.length < SPINNER_VERB_MIN)
		errors.push(
			`spinnerVerbs has ${String(spinnerVerbs.length)} entries, need >= ${String(SPINNER_VERB_MIN)}`,
		);
}

// Gate 6: cross-cell near-verbatim backstop. Flatten every character line (spinnerVerbs excluded), precompute one
// token set per line, and fail on a token-set Jaccard >= CROSS_CELL_JACCARD across two DIFFERENT cells. Only
// near-copies; semantic "same joke reworded" variety stays the reviewer's call.
function checkCrossCell(cells: readonly LeafCell[], errors: string[]): void {
	const flat: { path: string; line: string; tokens: Set<string> }[] = [];
	for (const cell of cells) {
		if (cell.path === "spinnerVerbs") continue;
		for (const line of cell.lines) flat.push({ path: cell.path, line, tokens: tokenSet(line) });
	}
	const jac = (a: Set<string>, b: Set<string>): number => {
		if (a.size === 0 && b.size === 0) return 0;
		let inter = 0;
		for (const t of a) if (b.has(t)) inter++;
		return inter / (a.size + b.size - inter);
	};
	for (let i = 0; i < flat.length; i++)
		for (let j = i + 1; j < flat.length; j++) {
			const a = flat[i];
			const b = flat[j];
			if (a === undefined || b === undefined || a.path === b.path) continue;
			if (jac(a.tokens, b.tokens) >= CROSS_CELL_JACCARD)
				errors.push(
					`cross-cell near-duplicate: ${a.path} "${a.line.slice(0, 28)}" ~ ${b.path} "${b.line.slice(0, 28)}"`,
				);
		}
}

// Gate 5: no line still carries the placeholder sentinel — a green full lint means every cell was actually
// written (coverage, not quality: a real-looking but lazy line still passes; that stays the reviewer's job).
function checkPlaceholders(cells: readonly LeafCell[], errors: string[]): void {
	for (const cell of cells)
		for (const line of cell.lines)
			if (line.includes(PLACEHOLDER_TOKEN)) {
				errors.push(`lines.${cell.path} still has an unwritten placeholder`);
				break;
			}
}

// Gate 4: no two lines in the same leaf cell at token-set Jaccard >= JACCARD_DUP.
function checkNearDuplicates(cells: readonly LeafCell[], errors: string[]): void {
	for (const cell of cells) {
		const arr = cell.lines;
		for (let i = 0; i < arr.length; i++)
			for (let j = i + 1; j < arr.length; j++) {
				const a = arr[i];
				const b = arr[j];
				if (a === undefined || b === undefined) continue;
				if (jaccard(a, b) >= JACCARD_DUP)
					errors.push(
						`${cell.path} has near-duplicate lines: "${a.slice(0, 30)}" ~ "${b.slice(0, 30)}"`,
					);
			}
	}
}

// Every file `npm publish` must ship from a pack, beyond the always-present pack.json.
const REQUIRED_PACKAGE_FILES = ["pack.json", "README.md", "assets"] as const;

// Publish-metadata gate: the sibling package.json must ship the README and the assets/ preview and point back
// at the pack's own directory, so `npm publish` never emits a package with no readme, no statusline shot, or a
// mislabeled name/directory. The scaffold emits a complete package.json; this catches drift (a pack authored
// before the scaffold fix, or a hand-edit). It needs the pack's directory name for the identity checks, so it
// lives here for the CLI to call rather than inside the path-less `lintPack`.
export function packageJsonErrors(raw: unknown, packName: string): string[] {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return ["package.json is missing or not an object"];
	const pkg = raw as Record<string, unknown>;
	const errors: string[] = [];

	const expectedName = `@ccsidekick/pack-${packName}`;
	if (pkg["name"] !== expectedName)
		errors.push(
			`package.json name is ${JSON.stringify(pkg["name"])}, expected "${expectedName}"`,
		);

	const files = pkg["files"];
	const missing = REQUIRED_PACKAGE_FILES.filter(
		(f) => !(Array.isArray(files) && files.includes(f)),
	);
	if (missing.length > 0)
		errors.push(
			`package.json "files" must include ${missing.map((f) => `"${f}"`).join(", ")} so the README and assets publish`,
		);

	const repo = pkg["repository"];
	const directory =
		typeof repo === "object" && repo !== null ?
			(repo as Record<string, unknown>)["directory"]
		:	undefined;
	const expectedDir = `packages/packs/${packName}`;
	if (directory !== expectedDir)
		errors.push(
			`package.json repository.directory is ${JSON.stringify(directory)}, expected "${expectedDir}"`,
		);

	const author = pkg["author"];
	if (typeof author !== "string" || author.trim() === "")
		errors.push('package.json is missing an "author"');

	return errors;
}

// Defensive read of a possibly-partial pack.json for `--status`. Never validates, never throws: any absent or
// mistyped branch yields []. Reads the array at a dotted leaf path under `lines`.
function linesAt(raw: unknown, path: string): readonly string[] {
	let node: unknown =
		typeof raw === "object" && raw !== null ? (raw as { lines?: unknown }).lines : undefined;
	for (const key of path.split(".")) {
		if (typeof node !== "object" || node === null || Array.isArray(node)) return [];
		node = (node as Record<string, unknown>)[key];
	}
	return Array.isArray(node) ? node.filter((l): l is string => typeof l === "string") : [];
}

/** Highest pairwise Jaccard similarity among the lines (0 when there are fewer than two). */
function maxJaccard(lines: readonly string[]): number {
	let max = 0;
	for (let i = 0; i < lines.length; i++)
		for (let j = i + 1; j < lines.length; j++)
			max = Math.max(max, jaccard(lines[i] ?? "", lines[j] ?? ""));
	return max;
}

export function statusReport(raw: unknown): string {
	const rows: string[] = [];
	let filledCells = 0;
	let filledLines = 0;
	for (const path of LEAF_PATHS) {
		const lines = linesAt(raw, path);
		const expected = expectedCount(path);
		const wide = lines.filter((l) => displayWidth(l) > CHAR_LINE_MAX).length;
		const maxJac = maxJaccard(lines);
		const holds = lines.filter((l) => l.includes(PLACEHOLDER_TOKEN)).length;
		if (lines.length >= expected && holds === 0) filledCells++;
		filledLines += Math.min(lines.length, expected);
		const flags = [
			wide > 0 ? `${String(wide)} wide` : "",
			maxJac >= JACCARD_DUP ? `dup ${maxJac.toFixed(2)}` : "",
			holds > 0 ? `${String(holds)} placeholder` : "",
		].filter((s) => s !== "");
		rows.push(
			`  ${path.padEnd(40)} ${String(lines.length)}/${String(expected)}${flags.length > 0 ? `  (${flags.join(", ")})` : ""}`,
		);
	}
	const header = `pack status: ${String(filledLines)}/${String(POOL_TOTAL)} lines, ${String(filledCells)}/${String(LEAF_PATHS.length)} cells complete`;
	return [header, ...rows].join("\n");
}

export function lintPack(pack: unknown, opts: { schemaOnly: boolean }): LintResult {
	const result = validatePackDetailed(pack);
	if ("error" in result) return { ok: false, errors: [result.error] };
	const p = result.pack;

	const errors: string[] = [];
	checkLegibility(p.art, errors);
	if (p.theme !== undefined) {
		for (const err of themeColorErrors(p.theme, "theme")) errors.push(err);
	}

	if (!opts.schemaOnly) {
		const cells = leafCells(p.lines, p.spinnerVerbs);
		checkPoolCounts(cells, errors);
		checkLineWidth(cells, errors);
		checkSpinnerVerbs(p.spinnerVerbs, errors);
		checkNearDuplicates(cells, errors);
		checkPlaceholders(cells, errors);
		checkCrossCell(cells, errors);
	}

	return { ok: errors.length === 0, errors };
}

function runCli(): void {
	const argv = process.argv.slice(2);
	const schemaOnly = argv.includes("--schema-only");
	const dir = argv.find((a) => !a.startsWith("--"));
	if (dir === undefined) {
		process.stderr.write("usage: pack:lint [--schema-only] <pack-dir>\n");
		process.exit(2);
	}
	if (argv.includes("--status")) {
		let raw: unknown = null;
		try {
			raw = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")) as unknown;
		} catch {
			// A missing or unparseable pack.json still reports (all zero); --status never fails.
		}
		process.stdout.write(`${statusReport(raw)}\n`);
		process.exit(0);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")) as unknown;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`pack:lint: failed to read ${dir}/pack.json: ${msg}\n`);
		process.exit(2);
	}
	const { errors } = lintPack(raw, { schemaOnly });

	let pkgRaw: unknown = null;
	try {
		pkgRaw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as unknown;
	} catch {
		// A missing or unparseable package.json is itself a finding, reported by packageJsonErrors.
	}
	const allErrors = [...errors, ...packageJsonErrors(pkgRaw, basename(dir))];

	if (allErrors.length === 0) {
		process.stdout.write(`pack:lint: ${dir} OK${schemaOnly ? " (schema-only)" : ""}\n`);
		process.exit(0);
	}
	for (const err of allErrors) process.stderr.write(`pack:lint: ${err}\n`);
	process.exit(1);
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) runCli();
