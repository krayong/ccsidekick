#!/usr/bin/env bun
// Write website/data.js (and sync the page's static stat numbers) from the real packs and the engine's own
// constants, so the landing page's character wall, per-character theme cards, theme catalog, widget cards, and
// counts all derive from the source of truth. Adding a pack, theme, or widget updates the site with no hand-edits.
// data.js is a plain assignment script (window.__CCSK = …) so it loads on file:// and hosted alike, no fetch/CORS.
// The stat grid in index.html is static HTML (crawlable without JS), so its three counts are patched here from the
// same computed counts — a pack/theme/widget change can't leave the page advertising a stale number.
//
//   bun run site:data      # -> website/data.js (+ index.html stat numbers)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildSiteData } from "./site-data-build";

const root = join(import.meta.dir, "..", "..");
const website = join(root, "website");

// The published engine version, used to keep the JSON-LD softwareVersion in step with each release.
const coreVersion = (
	JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8")) as {
		version: string;
	}
).version;

const data = buildSiteData();

writeFileSync(join(website, "data.js"), `window.__CCSK = ${JSON.stringify(data)};\n`);

// Patch the stat grid's hand-authored `data-to` numbers (the static, no-JS-needed counts a crawler reads) to
// the freshly computed counts, keyed by the stat's label so the three cards can't be transposed.
const statFor: Record<string, number> = {
	characters: data.counts.characters,
	themes: data.counts.themes,
	widgets: data.counts.widgets,
};
const indexPath = join(website, "index.html");
let html = readFileSync(indexPath, "utf8");
html = html.replace(
	/(data-to=")(\d+)("[^>]*>[\s\S]*?<div class="l">)(\w+)(<)/g,
	(m, pre: string, _num: string, mid: string, label: string, post: string) => {
		const want = statFor[label];
		return want === undefined ? m : `${pre}${String(want)}${mid}${label}${post}`;
	},
);
// Patch the JSON-LD softwareVersion to the published engine version. site:build runs on every deploy, so the
// structured data tracks each release with no hand-edit; site-drift guards it against drifting.
html = html.replace(
	/("softwareVersion":\s*")[^"]*(")/,
	(_m, pre: string, post: string) => `${pre}${coreVersion}${post}`,
);
writeFileSync(indexPath, html);

console.log(
	`wrote website/data.js — ${data.counts.characters} characters, ${data.counts.themes} themes, ${data.counts.widgets} widgets (index.html stats + softwareVersion ${coreVersion} synced)`,
);
