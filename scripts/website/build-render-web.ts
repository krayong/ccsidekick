#!/usr/bin/env bun
// Bundle the ccsidekick render engine for the browser (the interactive web configurator's live preview).
// Output: website/render-web.js — a self-contained IIFE exposing window.CCSKRender.renderStatusline(opts).
//
// The hot render path is Node-portable except for a handful of `node:*` reads (fs/path/os/child_process/url) and
// `node:crypto` hashing, plus the fs-resolved pack loader. A Bun.build plugin swaps each of those for a browser
// shim at bundle time, so the REAL compose/render/derive source stays untouched.

import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { BunPlugin } from "bun";

import { PACKS } from "../../packages/core/src/packs/registry";

import { packLoadSource } from "./pack-load-source";

const scriptDir = import.meta.dir;
const repoRoot = join(scriptDir, "..", "..");
const webDir = join(repoRoot, "packages", "core", "src", "web");
const shimDir = join(webDir, "node-shims");
const entry = join(webDir, "render-web.ts");
const outdir = join(repoRoot, "website");
const outfile = join(outdir, "render-web.js");

const NODE_SHIMS: Readonly<Record<string, string>> = {
	"node:fs": join(shimDir, "fs.ts"),
	"node:path": join(shimDir, "path.ts"),
	"node:os": join(shimDir, "os.ts"),
	"node:child_process": join(shimDir, "child_process.ts"),
	"node:url": join(shimDir, "url.ts"),
	"node:crypto": join(webDir, "crypto-shim.ts"),
};

const webPackLoad = join(webDir, "pack-load.ts");

const webShims: BunPlugin = {
	name: "ccsk-web-shims",
	setup(build) {
		build.onResolve({ filter: /^node:(fs|path|os|child_process|url|crypto)$/ }, (args) => {
			const path = NODE_SHIMS[args.path];
			return path !== undefined ? { path } : undefined;
		});
		// Replace the fs-resolved pack loader with a bundled-data loader generated from PACKS (same
		// validatePack guard). Deriving the import list means a newly-registered pack needs no hand-edit.
		build.onLoad({ filter: /\/packs\/load\.ts$/ }, () => ({
			contents: packLoadSource(PACKS, webPackLoad),
			loader: "ts",
		}));
	},
};

mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
	entrypoints: [entry],
	target: "browser",
	format: "iife",
	minify: true,
	plugins: [webShims],
	outdir,
	naming: "render-web.js",
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	throw new Error("render-web build failed");
}

// Some Bun versions restrict `format: "iife"`; if so this throws above and we surface the logs.
chmodSync(outfile, 0o644);
const bytes = result.outputs[0]?.size ?? 0;
console.log(`built ${outfile} (${(bytes / 1024).toFixed(1)} KiB)`);
