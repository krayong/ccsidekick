// scripts/website/site-render.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { buildContent } from "./site-content";
import { buildSiteContext } from "./site-context";
import { buildSiteData } from "./site-data-build";
import { renderTemplate } from "./site-template";

const website = join(import.meta.dir, "..", "..", "website");
const ctx = buildSiteContext();
const tpl = readFileSync(join(website, "index.template.html"), "utf8");
const html = renderTemplate(tpl, ctx as unknown as Record<string, unknown>);
const content = buildContent(buildSiteData().counts);

describe("rendered index.html", () => {
	const { counts } = buildSiteData();

	test("no residual template token survives", () => {
		expect(html).not.toContain("{{");
	});

	test("reusable copy + identity URLs resolve from the content module", () => {
		expect(html).toContain(`<title>${content.tagline}</title>`);
		expect(html).toContain(content.description);
		expect(html).toContain(content.repoUrl);
		expect(html).toContain(content.npmUrl);
		expect(html).toContain(`mailto:${content.email}`);
	});

	test("reusable strings are single-sourced as tokens in the template (no bare duplicates)", () => {
		expect(tpl).toContain("<title>{{tagline}}</title>");
		expect(tpl).toContain("{{repoUrl}}");
		expect(tpl).toContain("{{npmUrl}}");
		expect(tpl).toContain("{{email}}");
		expect(tpl).not.toContain(content.tagline);
		expect(tpl).not.toContain(content.repoUrl);
	});

	test("FAQ is single-sourced (visible + JSON-LD) from the content module", () => {
		for (const { q, a } of content.faq) {
			// each Q&A appears in the visible <details> AND the JSON-LD FAQPage
			expect(html.split(q).length - 1).toBeGreaterThanOrEqual(2);
			expect(html.split(a).length - 1).toBeGreaterThanOrEqual(2);
		}
		// no FAQ prose remains hardcoded in the template source
		expect(tpl).not.toContain("<summary>What is ccsidekick?</summary>");
		expect(tpl).toContain("{{faq.0.q}}");
		expect(tpl).toContain("{{faq.0.a}}");
	});

	test("stat grid data-to matches counts", () => {
		expect(html).toContain(`data-to="${counts.characters}"`);
		expect(html).toContain(`data-to="${counts.themes}" data-suf="+"`);
		expect(html).toContain(`data-to="${counts.widgets}"`);
	});

	test("JSON-LD softwareVersion equals core version", () => {
		expect(html).toContain(`"softwareVersion": "${ctx.version}"`);
	});

	test("count prose is present with the live counts (resolved output)", () => {
		expect(html).toContain(`${counts.widgets} widgets, each one optional.`);
		expect(html).toContain(
			`${counts.characters} bundled characters, ${counts.themes}+ themes, and ${counts.widgets} widgets`,
		);
	});

	test("canonical equals homepage + trailing slash exactly", () => {
		expect(html).toContain(`rel="canonical" href="${ctx.baseUrl}/"`);
	});

	// Guards a MISSED placeholder: run against the TEMPLATE SOURCE (still {{...}}), not the resolved
	// html — the resolved html necessarily contains "18 bundled characters" etc. A bare count literal
	// surviving in the template means an occurrence was not templatized in Task 5.
	test("no bare count literal survives in the template source", () => {
		expect(tpl).not.toMatch(/\b18 bundled character/);
		expect(tpl).not.toMatch(/\b33 (toggleable )?widget/);
		expect(tpl).not.toMatch(/\b75\+? (built-in )?theme/);
		expect(tpl).not.toMatch(/data-to="18"/);
		expect(tpl).not.toMatch(/data-to="33"/);
		expect(tpl).not.toMatch(/<span id="c-chars">18</);
		expect(tpl).not.toMatch(/<span id="c-themes">75\+</);
		expect(tpl).not.toMatch(/\?\? 18\b/);
		expect(tpl).not.toMatch(/\?\? 33\b/);
	});

	test("body copy is single-sourced from the content module (no bare duplicates)", () => {
		// a sample of headings/kickers no longer live as bare prose in the template source
		expect(tpl).not.toContain("Design your status line. Watch it render.");
		expect(tpl).not.toContain(">build your own<");
		expect(tpl).not.toContain("Built for people who live in Claude Code.");
		// the corresponding tokens are there instead
		expect(tpl).toContain("{{copy.build.heading}}");
		expect(tpl).toContain("{{copy.build.kicker}}");
		expect(tpl).toContain("{{copy.about.heading}}");
		// and the resolved html still renders that copy
		expect(html).toContain(content.copy.build.heading);
		expect(html).toContain(`>${content.copy.build.kicker}<`);
		expect(html).toContain(content.copy.about.heading);
	});

	test("product name + JSON-LD metadata are single-sourced (no bare label literals)", () => {
		// the product-name LABEL spots (og:site_name, JSON-LD name) are tokens, not bare "ccsidekick"
		expect(tpl).not.toContain('content="ccsidekick"');
		expect(tpl).not.toContain('"name": "ccsidekick"');
		expect(tpl).toContain("{{productName}}");
		// JSON-LD featureList + author + license come from the content module
		expect(tpl).toContain('"keywords": "{{keywords}}"');
		expect(tpl).toContain('"license": "{{licenseUrl}}"');
		expect(tpl).toContain('"name": "{{author}}"');
		// and they resolve in the output (npx-command "ccsidekick" is intentionally left literal)
		expect(html).toContain(`content="${content.productName}"`);
		expect(html).toContain(content.licenseUrl);
	});

	test("key structural nodes exist (static parse, no script execution)", () => {
		const win = new Window();
		win.document.body.innerHTML = html; // body.innerHTML does NOT execute <script>
		const doc = win.document;
		expect(doc.querySelectorAll(".n.gtext[data-to]").length).toBeGreaterThanOrEqual(3);
		expect(doc.querySelector("h2")).not.toBeNull();
	});
});
