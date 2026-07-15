import { describe, expect, test } from "bun:test";

import { renderTemplate } from "./site-template";

describe("renderTemplate", () => {
	test("resolves flat and dotted keys", () => {
		const out = renderTemplate("v{{version}} - {{counts.widgets}} widgets", {
			version: "1.6.2",
			counts: { widgets: 33 },
		});
		expect(out).toBe("v1.6.2 - 33 widgets");
	});

	test("throws on an unknown/undefined token", () => {
		expect(() => renderTemplate("{{missing}}", {})).toThrow(/missing/);
		expect(() => renderTemplate("{{counts.nope}}", { counts: {} })).toThrow(/counts\.nope/);
	});

	test("leaves text with no tokens unchanged and resolves repeats", () => {
		expect(renderTemplate("no tokens here", {})).toBe("no tokens here");
		expect(renderTemplate("{{n}}-{{n}}", { n: 5 })).toBe("5-5");
	});

	test("throws when a token resolves to a non-primitive", () => {
		expect(() => renderTemplate("{{counts}}", { counts: { widgets: 3 } })).toThrow(/counts/);
	});
});
