#!/usr/bin/env bun
// Generate website/tokens.css (the :root token block) from website/DESIGN.md, the single source of truth
// for the site's design tokens. Keeps the CSS variables and the design system in lockstep; site-drift fails
// if the committed pair drifts. Build/CI-time only.
//
//   bun run site:tokens    # -> website/tokens.css
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const src = readFileSync(join(root, "website", "DESIGN.md"), "utf8");
const fm = /^---\n([\s\S]*?)\n---/.exec(src)?.[1];
if (fm === undefined) throw new Error("website/DESIGN.md front-matter not found");

// Minimal parser for the flat token front-matter: a bare `section:` line opens a section, then each
// 2-space-indented `key: "value"` line is a token within it. Scalar keys (name/version/description) are ignored.
const sections: Record<string, Record<string, string>> = {};
let current: Record<string, string> | undefined;
for (const line of fm.split("\n")) {
	const name = /^([A-Z][\w-]*):\s*$/i.exec(line)?.[1];
	if (name !== undefined) {
		current = {};
		sections[name] = current;
		continue;
	}
	const kv = /^ +([\w-]+):\s*"(.*)"\s*$/.exec(line);
	const key = kv?.[1];
	const val = kv?.[2];
	if (key !== undefined && val !== undefined && current !== undefined) current[key] = val;
}

const decls: string[] = [];
const push = (prefix: string, section: string): void => {
	for (const [k, v] of Object.entries(sections[section] ?? {}))
		decls.push(`\t--${prefix}${k}: ${v};`);
};
push("", "colors");
push("", "typography");
push("r-", "rounded");
push("", "spacing");

const css = `/* Generated from website/DESIGN.md by \`bun run site:tokens\`. Do not edit. */\n:root {\n${decls.join("\n")}\n}\n`;
writeFileSync(join(root, "website", "tokens.css"), css);
console.log(`wrote website/tokens.css — ${decls.length} tokens`);
