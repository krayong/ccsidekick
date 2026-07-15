// scripts/website/site-seo.test.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { PACKS } from "../../packages/core/src/packs/registry";

import { buildSiteContext } from "./site-context";
import { buildSiteData, ORDER } from "./site-data-build";
import { renderTemplate } from "./site-template";

const website = join(import.meta.dir, "..", "..", "website");
const ctx = buildSiteContext();
const render = (tpl: string) =>
	renderTemplate(
		readFileSync(join(website, tpl), "utf8"),
		ctx as unknown as Record<string, unknown>,
	);
const html = render("index.template.html");

describe("index.html structured data + meta", () => {
	const win = new Window();
	win.document.body.innerHTML = html;
	const doc = win.document;

	test("every JSON-LD block parses and expected @types are present", () => {
		const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
		expect(blocks.length).toBeGreaterThan(0);
		const types = new Set<string>();
		for (const b of blocks) {
			const parsed = JSON.parse(b.textContent) as {
				"@type"?: string;
				"@graph"?: { "@type"?: string }[];
			};
			// a block is either a bare node with its own top-level @type (e.g. the FAQPage block) or a
			// @graph wrapper of several nodes (e.g. SoftwareApplication + WebSite) — collect both shapes.
			if (parsed["@type"] !== undefined) types.add(parsed["@type"]);
			for (const node of parsed["@graph"] ?? [])
				if (node["@type"] !== undefined) types.add(node["@type"]);
		}
		expect(types.has("SoftwareApplication")).toBe(true);
		expect(types.has("FAQPage")).toBe(true);
	});

	test("required meta / OG / canonical tags present", () => {
		expect(doc.querySelector('meta[property="og:url"]')).not.toBeNull();
		expect(doc.querySelector('meta[property="og:image"]')).not.toBeNull();
		expect(doc.querySelector('meta[name="twitter:card"]')).not.toBeNull();
		expect(doc.querySelector('link[rel="canonical"]')).not.toBeNull();
	});

	test("no numeric border-radius literal (radii go through the token scale)", () => {
		expect(html).not.toMatch(/border-radius:\s*\d/);
	});
});

describe("referenced assets exist in built website/", () => {
	test.each([
		"og.png",
		"favicon.svg",
		"apple-touch-icon.png",
		"data.js",
		"tokens.css",
		"render-web.js",
		"characters.mp4",
		"characters-poster.jpg",
		"wordmark.svg",
	])("%s exists", (asset) => {
		expect(existsSync(join(website, asset))).toBe(true);
	});
});

describe("llms/sitemap/robots resolve to the source of truth", () => {
	const { counts } = buildSiteData();
	test("llms counts equal buildSiteData counts", () => {
		const llms = render("llms.template.txt");
		expect(llms).toContain(`${counts.characters} bundled characters`);
		expect(llms).toContain(`${counts.widgets} widgets`);
		expect(llms).not.toContain("{{");
	});
	test("sitemap + robots base URL equal core homepage", () => {
		expect(render("sitemap.template.xml")).toContain(`<loc>${ctx.baseUrl}/</loc>`);
		expect(render("robots.template.txt")).toContain(`Sitemap: ${ctx.baseUrl}/sitemap.xml`);
	});
	test("llms install command is single-sourced from the content module", () => {
		const tpl = readFileSync(join(website, "llms.template.txt"), "utf8");
		expect(tpl).toContain("{{installCmd}}"); // templated, not a bare literal
		expect(tpl).not.toContain(ctx.installCmd);
		expect(render("llms.template.txt")).toContain(ctx.installCmd); // resolves back to the real command
	});
});

describe("data source invariants (widget samples + ORDER completeness)", () => {
	const data = buildSiteData();

	test("semantic snapshot: characters, themes, widgets (excludes the static xterm palette)", () => {
		expect({
			characters: data.characters,
			themes: data.themes,
			widgets: data.widgets,
		}).toMatchSnapshot();
	});

	test("every widget has a non-empty sample", () => {
		for (const w of data.widgets) expect(w.sample.length).toBeGreaterThan(0);
	});

	test("ORDER lists exactly the real packs (no missing/stale entry)", () => {
		expect([...ORDER].sort()).toEqual([...PACKS].sort());
	});
});
