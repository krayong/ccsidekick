import { expect, test } from "bun:test";

import stub from "../../../packs/batman/pack.json" with { type: "json" };

const REQUIRED = [
	"schema",
	"name",
	"displayName",
	"attribution",
	"emblem",
	"tone",
	"art",
	"lines",
	"spinnerVerbs",
] as const;
const LINE_POOLS = [
	"mood",
	"greeting",
	"firstContact",
	"milestone",
	"positiveGit",
	"egg",
	"event",
	"stack",
	"pressure",
	"dateEgg",
] as const;

test("batman stub is shape-valid", () => {
	for (const k of REQUIRED) expect(stub).toHaveProperty(k);
	expect(stub.schema).toBe(1);
	for (const k of LINE_POOLS) expect(stub.lines).toHaveProperty(k);
});

test("the figure is ≤9 rows, each row ≤25 display cols", () => {
	const figure = stub.art as readonly string[];
	expect(figure.length).toBeGreaterThan(0);
	expect(figure.length).toBeLessThanOrEqual(9);
	for (const row of figure) expect([...row].length).toBeLessThanOrEqual(25);
});
