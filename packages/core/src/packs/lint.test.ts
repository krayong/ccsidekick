import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test } from "bun:test";

import batmanPack from "../../../packs/batman/pack.json";
import fixture from "../../test/fixtures/packs/valid/pack.json";

import { PLACEHOLDER_TOKEN, lintPack, packageJsonErrors, statusReport } from "./lint";

// Fresh read per call: never mutate a shared imported fixture.
const batman = (): { lines: { mood: { idle: Record<string, string[]> } } } =>
	JSON.parse(readFileSync(join(import.meta.dir, "../../../packs/batman/pack.json"), "utf8")) as {
		lines: { mood: { idle: Record<string, string[]> } };
	};

const batmanDir = join(import.meta.dir, "../../../packs/batman");
const fixtureDir = join(import.meta.dir, "../../test/fixtures/packs/valid");
const lintTs = join(import.meta.dir, "lint.ts");

// 25 distinct in-voice spinner verbs, used to clear the spinner-verb floor so other gates can be isolated.
const VERBS = Array.from({ length: 25 }, (_, i) => `verb${String(i)}`);

test("schema-only passes batman", () => {
	expect(lintPack(batmanPack, { schemaOnly: true }).ok).toBe(true);
});

test("schema-only passes the fixture pack", () => {
	expect(lintPack(fixture, { schemaOnly: true }).ok).toBe(true);
});

test("full lint passes the complete batman pack", () => {
	const r = lintPack(batmanPack, { schemaOnly: false });
	expect(r.ok).toBe(true);
	expect(r.errors).toEqual([]);
});

test("full lint fails the fixture (under-count pools)", () => {
	const r = lintPack(fixture, { schemaOnly: false });
	expect(r.ok).toBe(false);
	expect(r.errors.join(" ")).toContain("expected");
});

test("schema validation failure short-circuits the lint", () => {
	const r = lintPack({ schema: 2 }, { schemaOnly: true });
	expect(r.ok).toBe(false);
	expect(r.errors.join(" ")).toContain("schema");
});

test("char-line gate flags a line over 66 display columns", () => {
	const clone = structuredClone(fixture);
	clone.lines.mood.idle.stranger = ["x".repeat(67)];
	const r = lintPack(clone, { schemaOnly: false });
	expect(r.ok).toBe(false);
	expect(r.errors.join(" ")).toContain("66");
	expect(r.errors.join(" ")).toContain("mood.idle.stranger");
});

test("char-line gate is a content gate (skipped under schema-only)", () => {
	const clone = structuredClone(fixture);
	clone.lines.mood.idle.stranger = ["x".repeat(67)];
	expect(lintPack(clone, { schemaOnly: true }).ok).toBe(true);
});

test("spinner-verb floor flags fewer than 25 verbs", () => {
	const clone = structuredClone(fixture);
	clone.spinnerVerbs = VERBS.slice(0, 24);
	const errs = lintPack(clone, { schemaOnly: false }).errors.join(" ");
	expect(errs).toContain("spinnerVerbs");
	expect(errs).toContain("25");
});

test("spinner-verb floor passes at 25 verbs", () => {
	const clone = structuredClone(fixture);
	clone.spinnerVerbs = VERBS;
	const floorErr = lintPack(clone, { schemaOnly: false }).errors.filter((e) => e.includes(">="));
	expect(floorErr).toEqual([]);
});

test("near-duplicate gate flags two near-identical lines in spinnerVerbs", () => {
	const clone = structuredClone(fixture);
	clone.spinnerVerbs = ["alpha beta gamma delta", "alpha beta gamma delta epsilon", ...VERBS];
	const r = lintPack(clone, { schemaOnly: false });
	expect(r.ok).toBe(false);
	expect(r.errors.join(" ")).toContain("spinnerVerbs");
});

test("near-duplicate gate flags two near-identical lines in one lines cell", () => {
	const clone = structuredClone(fixture);
	clone.lines.dateEgg = ["alpha beta gamma delta", "alpha beta gamma delta epsilon"];
	const r = lintPack(clone, { schemaOnly: false });
	expect(r.ok).toBe(false);
	expect(r.errors.join(" ")).toContain("dateEgg");
});

test("legibility gate (schema-only) rejects an over-dense figure", () => {
	const clone = structuredClone(fixture);
	clone.art = Array.from({ length: 9 }, () => "#".repeat(25));
	const r = lintPack(clone, { schemaOnly: true });
	expect(r.ok).toBe(false);
	expect(r.errors.join(" ")).toContain("dense");
});

test("legibility gate treats U+2800 (blank braille) as empty, not dense", () => {
	const clone = structuredClone(fixture);
	clone.art = Array.from({ length: 9 }, () => "⠀".repeat(25));
	const r = lintPack(clone, { schemaOnly: true });
	// U+2800 renders blank, so it counts as empty: braille art pads with it for uniform cell width.
	expect(r.errors.join(" ")).not.toContain("dense");
});

test("CLI exits 0 on full lint for complete batman, 1 on an under-count pack", () => {
	const okRun = spawnSync("bun", [lintTs, batmanDir]);
	expect(okRun.status).toBe(0);
	const failRun = spawnSync("bun", [lintTs, fixtureDir]);
	expect(failRun.status).toBe(1);
});

test("statusReport counts filled vs expected on a partial pack and never throws", () => {
	const raw = {
		lines: {
			mood: { idle: { stranger: ["one", "two"] } }, // 2 of 10
			dateEgg: ["a", "b", "c"], // 3 of 10
		},
	};
	const report = statusReport(raw);
	expect(report).toContain("mood.idle.stranger");
	expect(report).toContain("2/10");
	expect(report).toContain("dateEgg");
	expect(report).toMatch(/\b\d+\/620\b/); // overall progress
	expect(() => statusReport({})).not.toThrow(); // empty pack: all zero, no crash
	expect(() => statusReport(null)).not.toThrow();
	expect(() => statusReport([1, 2, 3])).not.toThrow(); // pack.json is a JSON array
});

test("PLACEHOLDER_TOKEN is exactly U+E000", () => {
	expect(PLACEHOLDER_TOKEN.length).toBe(1);
	expect(PLACEHOLDER_TOKEN.codePointAt(0)).toBe(0xe000);
});

test("full lint fails when any line still contains the placeholder sentinel", () => {
	const p = batman() as unknown as { lines: { egg: Record<string, string[]> } };
	const cur = p.lines.egg["stranger"] ?? [];
	p.lines.egg["stranger"] = [`${PLACEHOLDER_TOKEN} egg stranger`, ...cur.slice(1)];
	const { ok, errors } = lintPack(p, { schemaOnly: false });
	expect(ok).toBe(false);
	expect(errors.some((e) => e.includes("placeholder"))).toBe(true);
});

test("cross-cell near-verbatim lines fail full lint; shipped packs stay green", () => {
	const p = batman() as unknown as {
		lines: { egg: Record<string, string[]>; firstContact: Record<string, string[]> };
	};
	// A near-verbatim pair (8 vs 9 tokens, Jaccard 8/9 = 0.89 >= 0.85) across two DIFFERENT cells.
	p.lines.egg["stranger"] = [
		"the caped crusader keeps watch over gotham tonight",
		...(p.lines.egg["stranger"] ?? []).slice(1),
	];
	p.lines.firstContact["stranger"] = [
		"the caped crusader keeps watch over gotham city tonight",
		...(p.lines.firstContact["stranger"] ?? []).slice(1),
	];
	const r = lintPack(p, { schemaOnly: false });
	expect(r.ok).toBe(false);
	expect(r.errors.some((e) => e.includes("cross-cell"))).toBe(true);

	// Unmodified batman has no cross-cell near-dup (measured peak 0.625 < 0.85).
	expect(lintPack(batman(), { schemaOnly: false }).ok).toBe(true);
});

test("a mood.idle group sum of 50 with a skewed per-tier distribution now fails", () => {
	const p = batman();
	const idle = p.lines.mood.idle;
	// Move all of acquaintance's lines into stranger: group total stays 50, per-cell breaks.
	idle["stranger"] = [...(idle["stranger"] ?? []), ...(idle["acquaintance"] ?? [])];
	idle["acquaintance"] = [];
	const { ok, errors } = lintPack(p, { schemaOnly: false });
	expect(ok).toBe(false);
	expect(errors.some((e) => e.includes("mood.idle.stranger"))).toBe(true);
	expect(errors.some((e) => e.includes("mood.idle.acquaintance"))).toBe(true);
});

test("packageJsonErrors passes batman's real package.json", () => {
	const raw = JSON.parse(readFileSync(join(batmanDir, "package.json"), "utf8")) as unknown;
	expect(packageJsonErrors(raw, "batman")).toEqual([]);
});

test("packageJsonErrors flags an incomplete or mislabeled package.json", () => {
	const good = {
		name: "@ccsidekick/pack-x",
		files: ["pack.json", "README.md", "assets"],
		repository: { directory: "packages/packs/x" },
		author: "Someone <a@b.c>",
	};
	expect(packageJsonErrors(good, "x")).toEqual([]);
	// files missing README.md and assets: the README/preview would not publish.
	expect(packageJsonErrors({ ...good, files: ["pack.json"] }, "x").join(" ")).toContain("files");
	// author absent.
	const noAuthor: Record<string, unknown> = { ...good };
	delete noAuthor["author"];
	expect(packageJsonErrors(noAuthor, "x").join(" ")).toContain("author");
	// repository points at the wrong pack directory.
	expect(
		packageJsonErrors({ ...good, repository: { directory: "packages/packs/y" } }, "x").join(
			" ",
		),
	).toContain("directory");
	// name does not match the pack.
	expect(packageJsonErrors({ ...good, name: "@ccsidekick/pack-y" }, "x").join(" ")).toContain(
		"name",
	);
	// missing entirely.
	expect(packageJsonErrors(null, "x")).toHaveLength(1);
});

test("CLI fails a pack whose package.json omits the README/assets from files", () => {
	const tmp = mkdtempSync(join(tmpdir(), "packlint-"));
	const name = basename(tmp);
	// A complete, valid pack.json so only the package.json gate can fail.
	copyFileSync(join(batmanDir, "pack.json"), join(tmp, "pack.json"));
	writeFileSync(
		join(tmp, "package.json"),
		JSON.stringify({
			name: `@ccsidekick/pack-${name}`,
			files: ["pack.json"], // omits README.md and assets
			repository: { directory: `packages/packs/${name}` },
			author: "Someone <a@b.c>",
		}),
	);
	const run = spawnSync("bun", [lintTs, tmp]);
	expect(run.status).toBe(1);
	expect(run.stderr.toString()).toContain("package.json");
});
