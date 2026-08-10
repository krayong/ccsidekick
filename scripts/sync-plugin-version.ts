#!/usr/bin/env bun
// Copy the published package version into the plugin manifest. Changesets bumps
// packages/core/package.json only, so this runs right after `changeset version` inside `bun run ci:version`;
// scripts/plugin-manifest.test.ts fails CI if the two ever disagree. Build-time script, never shipped, so
// Bun-only APIs are fine here.
//
// Only plugin.json carries a version. The marketplace entry deliberately does not: `claude plugin validate
// --strict` does not require one there, and a second copy is a second thing that can drift.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const MANIFEST = ".claude-plugin/plugin.json";

const pkg = JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8")) as {
	version: string;
};
const { version } = pkg;

/**
 * Rewrite the `"version": "…"` in `rel` to the package version, as a targeted string replacement.
 * Deliberately NOT parse-and-reserialize: `JSON.stringify` re-expands arrays that Prettier keeps inline, so the
 * committed manifest and `format:check` would disagree on every release. Throws when there is no version key
 * to update, so a renamed or moved field fails loudly instead of silently skipping the bump.
 */
function bumpVersion(rel: string): void {
	const path = join(root, rel);
	const before = readFileSync(path, "utf8");
	const after = before.replaceAll(/"version": "[^"]*"/g, `"version": "${version}"`);
	if (!after.includes(`"version": "${version}"`)) {
		throw new Error(`${rel}: no "version" key to update`);
	}
	if (after !== before) writeFileSync(path, after);
}

bumpVersion(MANIFEST);
console.log(`synced ${MANIFEST} to ${version}`);
