#!/usr/bin/env bun
// Guard website/data.js (and the page's static stat numbers) against the packs/themes/widgets they describe.
// site-data.ts generates data.js from every pack.json plus the engine's exported constants via buildSiteData();
// this recomputes that exact payload and DEEP-COMPARES it against the committed data.js. A bare count/name check
// would pass while a changed colour, relabelled widget, swapped emblem, reordered wall, or a stale leftover entry
// silently went out of date; the deep compare catches all of them. It also fails when a widget ships with no
// sample copy (a new WidgetId with no WIDGET_META entry) so the site never quietly renders a blank card, and it
// re-checks the design-token scale and the static stat grid. Build/CI-time only — Bun APIs are fine here.
//
//   bun run site:drift    # exit 0 = website matches the source of truth, 1 = stale
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSiteData, ORDER } from "./site-data-build";

const root = join(import.meta.dir, "..", "..");
const website = join(root, "website");

const dataPath = join(website, "data.js");
if (!existsSync(dataPath)) {
	console.error("website/data.js is missing — run `bun run site:build`");
	process.exit(1);
}

// data.js is `window.__CCSK = {…};` — strip the assignment wrapper and parse the object.
const raw = readFileSync(dataPath, "utf8").trim();
const committed = JSON.parse(
	raw.replace(/^window\.__CCSK\s*=\s*/, "").replace(/;$/, ""),
) as unknown;
// round-trip the freshly computed payload through JSON so both sides compare as plain data.
const fresh = JSON.parse(JSON.stringify(buildSiteData())) as unknown;

const problems: string[] = [];

const isObj = (x: unknown): x is Record<string, unknown> =>
	x !== null && typeof x === "object" && !Array.isArray(x);

function diffArray(a: unknown[], b: unknown[], path: string): void {
	if (a.length !== b.length)
		problems.push(`${path}: length ${a.length} (data.js) vs ${b.length} (expected)`);
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`);
}

function diffObject(a: Record<string, unknown>, b: Record<string, unknown>, path: string): void {
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
		diff(a[k], b[k], path ? `${path}.${k}` : k);
}

/** Collect every path where the committed data.js (a) diverges from the freshly computed payload (b). */
function diff(a: unknown, b: unknown, path: string): void {
	if (problems.length >= 20) return; // cap the report; the first divergences are enough to act on
	if (Array.isArray(a) && Array.isArray(b)) diffArray(a, b, path);
	else if (isObj(a) && isObj(b)) diffObject(a, b, path);
	else if (a !== b)
		problems.push(`${path}: ${JSON.stringify(a)} (data.js) vs ${JSON.stringify(b)} (expected)`);
}
diff(committed, fresh, "");

// Metadata completeness: every widget card needs a sample value (site presentation copy that has no engine
// source). A new WidgetId with no WIDGET_META entry falls back to an empty sample, which would ship a blank
// card; fail loudly so adding a widget forces adding its sample.
interface Data {
	characters: { name: string }[];
	widgets: { id: string; sample: string }[];
}
const freshData = fresh as Data;
for (const w of freshData.widgets)
	if (w.sample === "")
		problems.push(
			`widget "${w.id}" has no sample — add a WIDGET_META entry in site-data-build.ts`,
		);

// ORDER is the authoritative wall order: every pack must be listed (a new pack must be placed in it, not left to
// fall to the end), and it must carry no stale name for a removed pack.
const orderSet = new Set(ORDER);
const packNames = new Set(freshData.characters.map((c) => c.name));
for (const c of freshData.characters)
	if (!orderSet.has(c.name))
		problems.push(
			`pack "${c.name}" is not in ORDER — add it to the wall order in site-data-build.ts`,
		);
for (const n of ORDER)
	if (!packNames.has(n))
		problems.push(`ORDER lists "${n}" but no such pack exists — remove it from ORDER`);

// design tokens: every var(--r-*) used in index.html must exist in website/DESIGN.md's rounded scale, and no
// literal border-radius may remain (all radii go through the token scale generated into tokens.css).
const design = readFileSync(join(website, "DESIGN.md"), "utf8");
const roundedBlock = /\nrounded:\n((?: +[\w-]+:.*\n)+)/.exec(design)?.[1] ?? "";
const roundedKeys = new Set(
	[...roundedBlock.matchAll(/^ +([\w-]+):/gm)]
		.map((m) => m[1])
		.filter((k): k is string => k !== undefined),
);
const html = readFileSync(join(website, "index.html"), "utf8");
for (const m of html.matchAll(/var\(--r-([\w-]+)\)/g)) {
	const k = m[1];
	if (k !== undefined && !roundedKeys.has(k))
		problems.push(`index.html uses var(--r-${k}) but website/DESIGN.md rounded has no "${k}"`);
}
if (/border-radius:\s*\d/.test(html))
	problems.push(
		"index.html has a literal border-radius; use a var(--r-*) token from website/DESIGN.md",
	);

// index.html carries the static stat grid (the `data-to` values a crawler reads without JS); guard them against
// the real counts so the committed page can't advertise a stale number. site:data patches these; this is the guard.
const freshCounts = (fresh as { counts: { characters: number; themes: number; widgets: number } })
	.counts;
const expectStat: Record<string, number> = {
	characters: freshCounts.characters,
	themes: freshCounts.themes,
	widgets: freshCounts.widgets,
};
for (const m of html.matchAll(/data-to="(\d+)"[^>]*>[\s\S]*?<div class="l">(\w+)</g)) {
	const rawNum = m[1];
	const label = m[2];
	if (rawNum === undefined || label === undefined) continue;
	const want = expectStat[label];
	if (want !== undefined && Number(rawNum) !== want)
		problems.push(`index.html stat "${label}" reads ${rawNum}, expected ${want}`);
}

// JSON-LD SoftwareApplication: its softwareVersion must track the published engine (site:data injects it from
// packages/core/package.json), and its featureList repeats the same character/theme/widget counts the stat grid
// shows. Guard both so structured data can't advertise a stale release or a stale count.
const ldRaw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
if (ldRaw !== undefined) {
	const graph = (JSON.parse(ldRaw) as { "@graph"?: unknown[] })["@graph"] ?? [];
	const app = graph.find(
		(n): n is Record<string, unknown> => isObj(n) && n["@type"] === "SoftwareApplication",
	);
	if (app === undefined) {
		problems.push("index.html JSON-LD has no SoftwareApplication node");
	} else {
		const coreVersion = (
			JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8")) as {
				version: string;
			}
		).version;
		if (app["softwareVersion"] !== coreVersion)
			problems.push(
				`index.html JSON-LD softwareVersion is ${JSON.stringify(app["softwareVersion"])}, expected "${coreVersion}" — run \`bun run site:build\``,
			);
		const featureRules: { re: RegExp; key: "themes" | "widgets" | "characters" }[] = [
			{ re: /theme/i, key: "themes" },
			{ re: /widget/i, key: "widgets" },
			{ re: /character pack|bundled character/i, key: "characters" },
		];
		const featureList = app["featureList"];
		if (Array.isArray(featureList))
			for (const rawEntry of featureList) {
				const entry = String(rawEntry);
				const num = /\d+/.exec(entry)?.[0];
				if (num === undefined) continue;
				for (const rule of featureRules)
					if (rule.re.test(entry)) {
						if (Number(num) !== freshCounts[rule.key])
							problems.push(
								`index.html JSON-LD featureList "${entry}" reads ${num}, expected ${freshCounts[rule.key]} ${rule.key}`,
							);
						break;
					}
			}
	}
}

if (problems.length > 0) {
	console.error(
		"website is stale — run `bun run site:build`:\n" +
			problems.map((p) => `  - ${p}`).join("\n"),
	);
	process.exit(1);
}
console.log(
	`website/data.js matches the source of truth — ${freshCounts.characters} characters, ${freshCounts.themes} themes, ${freshCounts.widgets} widgets`,
);
