#!/usr/bin/env bun
// Copy the canonical reel media + wordmark from assets/ into website/ so the built site is self-contained.
// assets/ stays the single source of truth; the website/ copies are generated build artifacts (gitignored).
// favicon.svg is website-only and is not copied here.
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const files = [
	"characters.mp4",
	"characters-poster.jpg",
	"wordmark.svg",
	"og.png",
	"apple-touch-icon.png",
];
for (const f of files) {
	copyFileSync(join(root, "assets", f), join(root, "website", f));
	console.log(`copied assets/${f} -> website/${f}`);
}
