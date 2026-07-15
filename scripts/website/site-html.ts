// Resolve the committed website/*.template.* sources into their gitignored static outputs, so the
// deployed page carries real version/counts/baseUrl as static markup while the committed source never
// changes per release. Mirrors the existing generated-artifact model (data.js, tokens.css, render-web.js).
//
//   bun run site:html   # -> website/{index.html,llms.txt,sitemap.xml,robots.txt}
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildSiteContext, type SiteContext } from "./site-context";
import { renderTemplate } from "./site-template";

const website = join(import.meta.dir, "..", "..", "website");

// template basename -> output basename
const FILES: Record<string, string> = {
	"index.template.html": "index.html",
	"llms.template.txt": "llms.txt",
	"sitemap.template.xml": "sitemap.xml",
	"robots.template.txt": "robots.txt",
};

export function renderTemplateFile(templatePath: string, outPath: string, ctx: SiteContext): void {
	writeFileSync(
		outPath,
		renderTemplate(
			readFileSync(templatePath, "utf8"),
			ctx as unknown as Record<string, unknown>,
		),
	);
}

if (import.meta.main) {
	const ctx = buildSiteContext();
	for (const [tpl, out] of Object.entries(FILES))
		renderTemplateFile(join(website, tpl), join(website, out), ctx);
	console.log(`resolved ${Object.keys(FILES).length} website templates (v${ctx.version})`);
}
