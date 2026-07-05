#!/usr/bin/env bun
// Guard the headline counts in the repo README against the code they describe. The README advertises a theme
// count, a widget count, a widget-id list, and a character-pack count in both its shields.io badges and its
// prose; each of those has a source of truth in the tree (the theme catalog, the WidgetId union, the packs
// directory). This is a build/CI-time script (never shipped), so Bun-only APIs are fine here.
//
//   bun packages/core/scripts/readme-drift.ts   # exit 0 = README matches code, 1 = drift
//
// Semantics: themes are a floor ("70+"), so the catalog may grow past the advertised number and still pass;
// widgets and packs are exact, and the widget-id list must be the WidgetId set with nothing missing or extra.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const README = readFileSync(join(root, "README.md"), "utf8");
const STRUCTS = readFileSync(join(root, "packages", "core", "src", "domain", "structs.ts"), "utf8");
const THEMES = readFileSync(join(root, "packages", "core", "src", "data", "themes.ts"), "utf8");

/** First capture group of `re` against `s`, or undefined (satisfies noUncheckedIndexedAccess). */
function group1(re: RegExp, s: string): string | undefined {
	return re.exec(s)?.[1];
}

/** Every quoted string in the `export type WidgetId = …;` union, in source order. */
function widgetIdsFromSource(): string[] {
	const block = group1(/export type WidgetId\s*=([\s\S]*?);/, STRUCTS);
	if (block === undefined) throw new Error("could not find the WidgetId union in structs.ts");
	return [...block.matchAll(/"([a-z0-9_]+)"/g)]
		.map((m) => m[1])
		.filter((v): v is string => v !== undefined);
}

/** The backtick-quoted ids in the README's `### Widgets` list (the sentence after "The ids:"). */
function widgetIdsFromReadme(): string[] {
	const start = README.indexOf("The ids:");
	if (start === -1) throw new Error('could not find "The ids:" in README.md');
	const paragraph = README.slice(start).split("\n\n")[0] ?? "";
	return [...paragraph.matchAll(/`([a-z0-9_]+)`/g)]
		.map((m) => m[1])
		.filter((v): v is string => v !== undefined);
}

const problems: string[] = [];

// --- Themes: a floor claim; the catalog may exceed it, never fall below. ---
const themeCount = (THEMES.match(/displayName:\s*"/g) ?? []).length;
const themeBadge = group1(/badge\/themes-(\d+)%2B/, README);
const themeProse = group1(/(\d+)\+ built-in themes/, README);
if (themeBadge === undefined) problems.push("README theme badge (themes-<n>%2B) not found");
if (themeProse === undefined)
	problems.push('README theme prose ("<n>+ built-in themes") not found');
if (themeBadge !== undefined && themeProse !== undefined && themeBadge !== themeProse) {
	problems.push(`theme floor disagrees: badge ${themeBadge}, prose ${themeProse}`);
}
const themeFloor = themeBadge ?? themeProse;
if (themeFloor !== undefined && themeCount < Number(themeFloor)) {
	problems.push(`themes: catalog has ${String(themeCount)}, README advertises ${themeFloor}+`);
}

// --- Widgets: exact count and exact id set. ---
const widgetIds = widgetIdsFromSource();
const widgetBadge = group1(/badge\/widgets-(\d+)/, README);
const widgetProse = group1(/(\d+) toggleable widgets/, README);
const n = String(widgetIds.length);
if (widgetBadge !== n) problems.push(`widget badge says ${widgetBadge ?? "?"}, code has ${n}`);
if (widgetProse !== n) problems.push(`widget prose says ${widgetProse ?? "?"}, code has ${n}`);

const readmeIds = new Set(widgetIdsFromReadme());
const codeIds = new Set(widgetIds);
const missing = widgetIds.filter((id) => !readmeIds.has(id));
const extra = [...readmeIds].filter((id) => !codeIds.has(id));
if (missing.length > 0) problems.push(`widget ids in code but not README: ${missing.join(", ")}`);
if (extra.length > 0) problems.push(`widget ids in README but not code: ${extra.join(", ")}`);

// --- Packs: exact count of pack directories. ---
const packCount = readdirSync(join(root, "packages", "packs"), { withFileTypes: true }).filter(
	(e) => e.isDirectory(),
).length;
const packBadge = group1(/badge\/characters-(\d+)%20packs/, README);
if (packBadge !== String(packCount)) {
	problems.push(`pack badge says ${packBadge ?? "?"}, tree has ${String(packCount)} packs`);
}

if (problems.length > 0) {
	process.stderr.write("README drift detected:\n");
	for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
	process.stderr.write("\nUpdate README.md to match the code (or vice versa).\n");
	process.exit(1);
}

process.stdout.write(
	`README in sync: ${n} widgets, ${String(themeCount)} themes (floor ${themeFloor ?? "?"}+), ` +
		`${String(packCount)} packs.\n`,
);
