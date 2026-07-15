// scripts/website/site-demo.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, test } from "bun:test";

const bundlePath = join(import.meta.dir, "..", "..", "website", "render-web.js");

describe("built render-web.js", () => {
	test("exposes CCSKRender.renderStatusline and renders a non-empty status line", async () => {
		const code = readFileSync(bundlePath, "utf8");
		GlobalRegistrator.register();
		try {
			// The IIFE assigns window.CCSKRender. A broken bundle (bad IIFE / shim drift) throws here.
			// happy-dom's Window has no working .eval bound to `window`, so globals are registered
			// onto globalThis instead and the bundle is evaluated directly.
			eval(code);
			const api = (
				globalThis as unknown as {
					CCSKRender?: { renderStatusline: (o: unknown) => string };
				}
			).CCSKRender;
			expect(api).toBeDefined();
			const out = api!.renderStatusline({ character: "batman", noColor: true, columns: 120 });
			expect(typeof out).toBe("string");
			expect(out.length).toBeGreaterThan(0);
			// A degraded/empty render is caught: the status line always carries the cell separator.
			expect(out).toContain("│");
		} finally {
			await GlobalRegistrator.unregister();
		}
	});
});
