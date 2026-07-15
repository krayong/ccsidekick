// Build the render context for the website templates from the source of truth: version + baseUrl from
// core's package.json, counts from buildSiteData(), and lastmod from the HEAD commit date (deterministic,
// so identical sources produce byte-identical output — required for the unchanged-output deploy skip).
// NOTE: charactersMore = counts.characters - 3 is coupled to the three characters NAMED in the llms.txt
// blurb ("Batman, Spider-Man, Yoda, and {{charactersMore}} more"). If that blurb's named list changes,
// change the 3 here too.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildContent, type Content } from "./site-content";
import { buildSiteData } from "./site-data-build";

const root = join(import.meta.dir, "..", "..");

interface CorePkg {
	version: string;
	homepage: string;
}

export interface SiteContext extends Content {
	version: string;
	baseUrl: string;
	counts: { characters: number; themes: number; widgets: number };
	charactersMore: number;
	lastmod: string;
	bgColor: string;
}

export function buildSiteContext(): SiteContext {
	const pkg = JSON.parse(
		readFileSync(join(root, "packages", "core", "package.json"), "utf8"),
	) as CorePkg;
	const { counts } = buildSiteData();
	const lastmod = execFileSync("git", ["log", "-1", "--format=%cs"], { cwd: root })
		.toString()
		.trim();
	// The <meta name="theme-color"> (browser chrome) must match the page background; source it from the
	// same DESIGN.md front-matter that generates the --bg token so the two can't drift.
	const design = readFileSync(join(root, "website", "DESIGN.md"), "utf8");
	const bgColor = /^\s*bg:\s*"(#[0-9a-fA-F]+)"/m.exec(design)?.[1] ?? "#0b0e14";
	return {
		...buildContent(counts),
		version: pkg.version,
		baseUrl: pkg.homepage.replace(/\/$/, ""),
		counts,
		charactersMore: counts.characters - 3,
		lastmod,
		bgColor,
	};
}
