#!/usr/bin/env bun
// Write website/data.js from the real packs and the engine's own constants, so the landing page's
// character wall, per-character theme cards, theme catalog, widget cards, and counts all derive from the
// source of truth. data.js is a plain assignment script (window.__CCSK = …) so it loads on file:// and
// hosted alike, no fetch/CORS. The page's static counts/version live in index.template.html and are
// resolved by site:html.
//
//   bun run site:data      # -> website/data.js
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildSiteData } from "./site-data-build";

const root = join(import.meta.dir, "..", "..");
const website = join(root, "website");

const data = buildSiteData();

writeFileSync(join(website, "data.js"), `window.__CCSK = ${JSON.stringify(data)};\n`);

console.log(
	`wrote website/data.js — ${data.counts.characters} characters, ${data.counts.themes} themes, ${data.counts.widgets} widgets`,
);
