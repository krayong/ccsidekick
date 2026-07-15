import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildContent } from "./site-content";
import { renderTemplateFile } from "./site-html";

describe("renderTemplateFile", () => {
	test("resolves a template file to its output with the given context", () => {
		const dir = mkdtempSync(join(tmpdir(), "ccsk-html-"));
		const tpl = join(dir, "x.template.txt");
		const out = join(dir, "x.txt");
		writeFileSync(tpl, "v{{version}} {{counts.widgets}}w {{baseUrl}}/og.png");
		renderTemplateFile(tpl, out, {
			...buildContent({ characters: 1, themes: 2, widgets: 3 }),
			version: "9.9.9",
			baseUrl: "https://example.com",
			counts: { characters: 1, themes: 2, widgets: 3 },
			charactersMore: -2,
			lastmod: "2026-07-15",
			bgColor: "#0b0e14",
		});
		expect(readFileSync(out, "utf8")).toBe("v9.9.9 3w https://example.com/og.png");
	});
});
