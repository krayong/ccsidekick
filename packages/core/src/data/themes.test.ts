import { expect, test } from "bun:test";

import batman from "../../../packs/batman/pack.json" with { type: "json" };
import { themeColorErrors } from "../render";

import { THEMES } from "./themes";

test("THEMES.houston exists (the guaranteed fallback key)", () => {
	expect(THEMES.houston).toBeDefined();
	expect(THEMES.houston.displayName).toBe("Houston");
});

test("every built-in theme passes the color rules", () => {
	for (const [name, t] of Object.entries(THEMES)) {
		expect({ name, errors: themeColorErrors(t, name) }).toEqual({ name, errors: [] });
	}
});

test("every built-in theme has a non-empty displayName", () => {
	for (const t of Object.values(THEMES)) expect(t.displayName.length).toBeGreaterThan(0);
});

test("batman pack theme passes the color rules", () => {
	expect(batman.theme).toBeDefined();
	expect(themeColorErrors(batman.theme, "batman.theme")).toEqual([]);
});
