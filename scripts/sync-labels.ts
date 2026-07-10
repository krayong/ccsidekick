#!/usr/bin/env bun
// Ensure every PR label exists with a sensible colour before the labeler applies it. Each pack label takes its
// character's dominant theme colour (the same hex the site wall uses); the category labels take fixed, distinct
// colours. Idempotent upsert via `gh label create --force` (creates a missing label, updates an existing one's
// colour/description). CI-only: needs the `gh` CLI and a GH_TOKEN with issues:write. Mirrors .github/labeler.yml.
import { spawnSync } from "node:child_process";

import { buildSiteData } from "./website/site-data-build";

interface Label {
	name: string;
	color: string; // 6-hex, no leading '#'
	description: string;
}

// fixed, visually distinct colours for the non-pack category labels
const CATEGORIES: Label[] = [
	{ name: "core", color: "1f6feb", description: "The engine (packages/core)" },
	{ name: "website", color: "2da44e", description: "The landing page and its build scripts" },
	{ name: "ci/cd", color: "d29922", description: "Repo scripts and GitHub workflows" },
	{
		name: "agents",
		color: "8250df",
		description: "Agent config (.claude, CLAUDE.md, AGENTS.md)",
	},
];

// one label per pack, coloured by the pack's own theme (buildSiteData resolves the dominant hue to hex)
const packLabels: Label[] = buildSiteData().characters.map((c) => ({
	name: `${c.name} pack`,
	color: c.color.replace(/^#/, ""),
	description: `The ${c.name} character pack`,
}));

for (const { name, color, description } of [...CATEGORIES, ...packLabels]) {
	const r = spawnSync(
		"gh",
		["label", "create", name, "--color", color, "--description", description, "--force"],
		{ stdio: "inherit" },
	);
	if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log(`synced ${String(CATEGORIES.length + packLabels.length)} labels`);
