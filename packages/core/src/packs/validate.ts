// The single hand-written guard that narrows attacker-shaped JSON (`unknown`) into a `PackJson`. This is a
// sanctioned unknown-boundary site: `no-unsafe-*` is disabled here so the guard can read loose JSON. Validation
// is schema/shape only (the per-pool count gates and content gates live in `packs/lint`); a schema-major
// mismatch, a missing/empty pool, or any malformed identity/voice/art/theme field is rejected here so the loader
// can drop the figure rather than crash on bad data.
//
// Hardening (defense in depth — packs are bundled first-party data today, but this guard becomes load-bearing
// the moment any third-party path exists): every known field is read by name (never a generic deep-merge or
// whole-object spread that could smuggle attacker keys into engine objects); the dangerous keys `__proto__`,
// `constructor`, and `prototype` are rejected anywhere in the parsed data; and array/string lengths are bounded.
//
// Legacy keys `colors`, `palette`, and `colorMaps` are silently ignored — an on-disk pack that still carries
// them validates without error; the keys are never read into the built PackJson. Rejection of a truly legacy
// pack comes from the `theme` validator, not from these dropped fields.

import {
	MOODS,
	PRESSURE_MOODS,
	REACTION_CATEGORIES,
	STACKS,
	TIERS,
	type PackAttribution,
	type PackJson,
	type PackTheme,
} from "../domain";
import { type ThemeColors, displayWidth, themeColorErrors } from "../render";

const FIGURE_MAX_ROWS = 9;
const FIGURE_MAX_COLS = 25;
const MAX_STR = 4000; // any single pack string
const MAX_ARRAY = 2000; // any pack line pool / spinnerVerbs / hues
const MAX_DEPTH = 32; // parsed-object nesting cap for the prototype-pollution scan

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TONES = new Set(["mild", "edgy", "offensive"]);

const GREETING_BUCKETS = ["morning", "day", "evening", "night", "weekend"];
const MILESTONES = ["tier_up", "comeback", "streak", "anniversary"];
const POSITIVE_GIT = ["clean_tree", "op_cleared", "branch_created", "tag_pushed"];
const STACK_MOMENTS = ["slow", "fail"];

type PoolSpec =
	| { kind: "record2"; outer: readonly string[]; inner: readonly string[] }
	| { kind: "record1"; outer: readonly string[] }
	| { kind: "array" };

// The 10 lines pools, with their allowed outer (and for record2, inner) key sets. All must be present with the
// correct nesting; counts and content are full-lint-only, so an empty pool object is structurally valid.
const POOL_SPECS: Record<string, PoolSpec> = {
	mood: { kind: "record2", outer: MOODS, inner: TIERS },
	greeting: { kind: "record2", outer: GREETING_BUCKETS, inner: TIERS },
	firstContact: { kind: "record1", outer: TIERS },
	milestone: { kind: "record2", outer: MILESTONES, inner: TIERS },
	positiveGit: { kind: "record2", outer: POSITIVE_GIT, inner: TIERS },
	egg: { kind: "record1", outer: TIERS },
	event: { kind: "record1", outer: REACTION_CATEGORIES },
	stack: { kind: "record2", outer: STACKS, inner: STACK_MOMENTS },
	pressure: { kind: "record1", outer: PRESSURE_MOODS },
	dateEgg: { kind: "array" },
};

const isObj = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isColor = (v: unknown): boolean =>
	typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;
const isNonEmptyStr = (v: unknown): boolean => isStr(v) && v.length > 0 && v.length <= MAX_STR;
const glyphCount = (s: string): number => Array.from(s).length;

const isStringArray = (v: unknown): boolean =>
	Array.isArray(v) && v.length <= MAX_ARRAY && v.every((x) => isStr(x) && x.length <= MAX_STR);

function hasDangerousKey(v: unknown, depth: number): boolean {
	if (depth > MAX_DEPTH) return true;
	if (Array.isArray(v)) return v.some((e) => hasDangerousKey(e, depth + 1));
	if (isObj(v)) {
		for (const k of Object.keys(v)) {
			if (DANGEROUS_KEYS.has(k)) return true;
			if (hasDangerousKey(v[k], depth + 1)) return true;
		}
	}
	return false;
}

function validateTheme(theme: unknown): string | null {
	if (!isObj(theme)) return "theme must be an object";
	const hues = theme["hues"];
	if (!Array.isArray(hues) || hues.length < 4 || hues.length > 5 || !hues.every(isColor))
		return "theme.hues must be 4..5 integers in 0..255";
	const comment = theme["comment"];
	if (
		!Array.isArray(comment) ||
		comment.length < 2 ||
		comment.length > 3 ||
		!comment.every(isColor)
	)
		return "theme.comment must be an array of 2..3 stops in 0..255";
	const signals = theme["signals"];
	if (
		!isObj(signals) ||
		!isColor(signals["nominal"]) ||
		!isColor(signals["caution"]) ||
		!isColor(signals["critical"])
	)
		return "theme.signals must have integer nominal/caution/critical in 0..255";
	if (!isColor(theme["separator"])) return "theme.separator must be an integer in 0..255";
	// §2 color invariants (shared with the built-in catalog and lint).
	const colorErr = themeColorErrors(
		{
			hues: hues as number[],
			comment: comment as number[],
			signals: signals as ThemeColors["signals"],
			separator: theme["separator"] as number,
		},
		"theme",
	)[0];
	return colorErr ?? null;
}

function validateArt(art: unknown): string | null {
	if (!Array.isArray(art) || art.length === 0 || art.length > FIGURE_MAX_ROWS)
		return `art must be a non-empty array of at most ${FIGURE_MAX_ROWS} rows`;
	for (const row of art) {
		if (!isStr(row) || row.length > MAX_STR) return "a row in art must be a string";
		if (displayWidth(row) > FIGURE_MAX_COLS)
			return `a row in art exceeds ${FIGURE_MAX_COLS} columns`;
	}
	return null;
}

function validateRecord2Entry(
	pool: string,
	k: string,
	inner: unknown,
	innerKeys: ReadonlySet<string>,
): string | null {
	if (!isObj(inner)) return `lines.${pool}.${k} must be an object`;
	for (const [ik, leaf] of Object.entries(inner)) {
		if (!innerKeys.has(ik)) return `lines.${pool}.${k} has an unknown key: ${ik}`;
		if (!isStringArray(leaf)) return `lines.${pool}.${k}.${ik} must be an array of strings`;
	}
	return null;
}

function validatePool(pool: string, spec: PoolSpec, v: unknown): string | null {
	if (spec.kind === "array")
		return isStringArray(v) ? null : `lines.${pool} must be an array of strings`;
	if (!isObj(v)) return `lines.${pool} must be an object`;
	const outer = new Set(spec.outer);
	const innerKeys = spec.kind === "record2" ? new Set(spec.inner) : null;
	for (const [k, inner] of Object.entries(v)) {
		if (!outer.has(k)) return `lines.${pool} has an unknown key: ${k}`;
		if (innerKeys === null) {
			if (!isStringArray(inner)) return `lines.${pool}.${k} must be an array of strings`;
			continue;
		}
		const err = validateRecord2Entry(pool, k, inner, innerKeys);
		if (err !== null) return err;
	}
	return null;
}

function validateLines(lines: unknown): string | null {
	if (!isObj(lines)) return "lines must be an object";
	for (const [pool, spec] of Object.entries(POOL_SPECS)) {
		const v = lines[pool];
		if (v === undefined) return `lines.${pool} is required`;
		const err = validatePool(pool, spec, v);
		if (err !== null) return err;
	}
	return null;
}

function buildAttribution(a: Record<string, unknown>): PackAttribution {
	const out: Record<string, unknown> = { artist: a["artist"], source: a["source"] };
	return out as unknown as PackAttribution;
}

function buildTheme(t: Record<string, unknown>): PackTheme {
	return {
		hues: t["hues"],
		comment: t["comment"],
		signals: {
			nominal: (t["signals"] as Record<string, unknown>)["nominal"],
			caution: (t["signals"] as Record<string, unknown>)["caution"],
			critical: (t["signals"] as Record<string, unknown>)["critical"],
		},
		separator: t["separator"],
	} as unknown as PackTheme;
}

// Reads each known field by name and rebuilds nested known structures (never a whole-object spread). Top-level
// lines pools are filtered to their known keys; leaf values are carried after shape validation.
function buildPack(r: Record<string, unknown>): PackJson {
	const lines: Record<string, unknown> = {};
	const rawLines = r["lines"] as Record<string, unknown>;
	for (const pool of Object.keys(POOL_SPECS)) lines[pool] = rawLines[pool];

	const pack: Record<string, unknown> = {
		schema: 1,
		name: r["name"],
		displayName: r["displayName"],
		attribution: buildAttribution(r["attribution"] as Record<string, unknown>),
		emblem: r["emblem"],
		tone: r["tone"],
		art: r["art"],
		lines,
		spinnerVerbs: r["spinnerVerbs"],
	};
	const theme = r["theme"];
	if (theme !== undefined) pack["theme"] = buildTheme(theme as Record<string, unknown>);
	return pack as unknown as PackJson;
}

export function validatePackDetailed(raw: unknown): { pack: PackJson } | { error: string } {
	if (hasDangerousKey(raw, 0)) return { error: "pack contains a dangerous key" };
	if (!isObj(raw)) return { error: "pack must be an object" };

	if (raw["schema"] !== 1) return { error: `unsupported schema major: ${String(raw["schema"])}` };

	if (!isNonEmptyStr(raw["name"])) return { error: "name must be a non-empty string" };
	if (!isNonEmptyStr(raw["displayName"]))
		return { error: "displayName must be a non-empty string" };

	const attribution = raw["attribution"];
	if (
		!isObj(attribution) ||
		!isNonEmptyStr(attribution["artist"]) ||
		!isNonEmptyStr(attribution["source"])
	)
		return { error: "attribution.artist and attribution.source must be non-empty" };

	const emblem = raw["emblem"];
	if (!isStr(emblem) || glyphCount(emblem) !== 1)
		return { error: "emblem must be a single glyph" };

	const tone = raw["tone"];
	if (!isStr(tone) || !TONES.has(tone)) return { error: "tone must be mild, edgy, or offensive" };

	const themeErr = raw["theme"] === undefined ? null : validateTheme(raw["theme"]);
	if (themeErr !== null) return { error: themeErr };

	const artErr = validateArt(raw["art"]);
	if (artErr !== null) return { error: artErr };

	const linesErr = validateLines(raw["lines"]);
	if (linesErr !== null) return { error: linesErr };

	if (!isStringArray(raw["spinnerVerbs"]))
		return { error: "spinnerVerbs must be an array of strings" };

	return { pack: buildPack(raw) };
}

export const validatePack = (raw: unknown): PackJson | null => {
	const result = validatePackDetailed(raw);
	return "pack" in result ? result.pack : null;
};
