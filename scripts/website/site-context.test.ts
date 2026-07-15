import { describe, expect, test } from "bun:test";

import { buildSiteContext } from "./site-context";
import { buildSiteData } from "./site-data-build";

describe("buildSiteContext", () => {
	const ctx = buildSiteContext();

	test("version and baseUrl come from core package.json, baseUrl has no trailing slash", () => {
		expect(ctx.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(ctx.baseUrl).toBe("https://ccsidekick.krayong.com");
		expect(ctx.baseUrl.endsWith("/")).toBe(false);
	});

	test("counts mirror buildSiteData and charactersMore is characters - 3", () => {
		const { counts } = buildSiteData();
		expect(ctx.counts).toEqual(counts);
		expect(ctx.charactersMore).toBe(counts.characters - 3);
	});

	test("lastmod is an ISO date", () => {
		expect(ctx.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
