import { expect, test } from "bun:test";

import stub from "../../../packs/batman/pack.json" with { type: "json" };
import invalidSchema from "../../test/fixtures/packs/invalid-schema/pack.json" with { type: "json" };
import good from "../../test/fixtures/packs/valid/pack.json" with { type: "json" };

import { validatePack, validatePackDetailed } from "./validate";

test("accepts the valid fixture pack", () => {
	expect(validatePack(good)).not.toBeNull();
	expect(validatePackDetailed(good)).toHaveProperty("pack");
});

test("accepts the batman stub (empty pools, no theme)", () => {
	expect(validatePack(stub)).not.toBeNull();
});

test("rejects a non-object", () => {
	expect(validatePack(null)).toBeNull();
	expect(validatePack(42)).toBeNull();
	expect(validatePack("nope")).toBeNull();
	expect(validatePack([])).toBeNull();
});

test("rejects an unknown schema major", () => {
	const result = validatePackDetailed({ ...good, schema: 2 });
	expect(result).toHaveProperty("error");
	expect((result as { error: string }).error).toContain("schema");
	expect(validatePack(invalidSchema)).toBeNull();
});

test("rejects an empty figure", () => {
	expect(validatePack({ ...good, art: [] })).toBeNull();
});

test("rejects an over-wide figure row", () => {
	expect(validatePack({ ...good, art: ["x".repeat(26)] })).toBeNull();
});

test("rejects a figure over nine rows", () => {
	expect(validatePack({ ...good, art: Array.from({ length: 10 }, () => "x") })).toBeNull();
});

test("accepts a valid figure with rows of differing widths", () => {
	expect(validatePack({ ...good, art: ["abc", "ab"] })).not.toBeNull();
});

test("rejects malformed identity/voice fields", () => {
	expect(validatePack({ ...good, name: "" })).toBeNull();
	expect(validatePack({ ...good, displayName: "" })).toBeNull();
	expect(validatePack({ ...good, emblem: "AB" })).toBeNull();
	expect(validatePack({ ...good, emblem: "" })).toBeNull();
	expect(validatePack({ ...good, tone: "spicy" })).toBeNull();
});

test("rejects empty attribution artist or source", () => {
	expect(validatePack({ ...good, attribution: { artist: "", source: "x" } })).toBeNull();
	expect(validatePack({ ...good, attribution: { artist: "x", source: "" } })).toBeNull();
});

test("rejects a structurally-absent lines pool", () => {
	const lines: Record<string, unknown> = { ...good.lines };
	delete lines["dateEgg"];
	expect(validatePack({ ...good, lines })).toBeNull();
});

test("rejects a wrong-typed spinnerVerbs shape", () => {
	expect(validatePack({ ...good, spinnerVerbs: [1, 2, 3] })).toBeNull();
	expect(validatePack({ ...good, spinnerVerbs: "nope" })).toBeNull();
});

test("rejects a foreign lines.event key", () => {
	const event = { ...good.lines.event, not_a_reaction: ["x"] };
	expect(validatePack({ ...good, lines: { ...good.lines, event } })).toBeNull();
});

test("validates the native theme block", () => {
	const theme = {
		hues: [220, 178, 111, 75],
		comment: [117, 223, 178],
		signals: { nominal: 46, caution: 214, critical: 196 },
		separator: 111,
	};
	expect(validatePack({ ...good, theme })).not.toBeNull();
	// old-shape comment (object with gradient) fails because comment must be a number array
	expect(
		validatePack({ ...good, theme: { ...theme, comment: { gradient: [117, 223, 178] } } }),
	).toBeNull();
	// hues < 4 stops is rejected
	expect(validatePack({ ...good, theme: { ...theme, hues: [75, 147, 77] } })).toBeNull();
	// grey separator fails the color rules
	expect(validatePack({ ...good, theme: { ...theme, separator: 244 } })).toBeNull();
	// critical signal in wrong hue family fails the color rules
	expect(
		validatePack({ ...good, theme: { ...theme, signals: { ...theme.signals, critical: 46 } } }),
	).toBeNull();
});

test("rejects a prototype-pollution key anywhere in the parsed object", () => {
	const polluted = JSON.parse('{"schema":1,"__proto__":{"x":1}}') as unknown;
	expect(validatePack(polluted)).toBeNull();
});

test("a legacy pack with colors/palette/colorMaps still validates (the keys are ignored)", () => {
	const legacy = { ...good, colors: { base: 250 }, palette: { a: 21 } };
	expect(validatePack(legacy)).not.toBeNull(); // unknown keys are not rejected, just dropped
});
