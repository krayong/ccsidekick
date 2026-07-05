import { expect, test } from "bun:test";

import { DEFAULT_CONFIG, type Config } from "../../sources";

import { savePreviewSet } from "./savePreview";

const cfg = (character: Partial<Config["character"]>): Config => ({
	...DEFAULT_CONFIG,
	character: { ...DEFAULT_CONFIG.character, ...character },
});

test("fixed mode previews only the chosen character", () => {
	const set = savePreviewSet(cfg({ mode: "fixed", name: "robin" }), ["batman"], ["batman"]);
	expect(set).toEqual(["robin"]);
});

test("random mode previews the roster when non-empty", () => {
	const set = savePreviewSet(
		cfg({ mode: "random", roster: ["batman", "robin"] }),
		["batman"],
		["batman", "robin"],
	);
	expect(set).toEqual(["batman", "robin"]);
});

test("random mode with an empty roster falls back to installed packs", () => {
	const set = savePreviewSet(
		cfg({ mode: "random", roster: [] }),
		["batman", "spiderman"],
		["batman", "spiderman", "harry-potter"],
	);
	expect(set).toEqual(["batman", "spiderman"]);
});

test("random mode with no roster and no installed falls back to packs", () => {
	const set = savePreviewSet(cfg({ mode: "random", roster: [] }), [], ["harry-potter"]);
	expect(set).toEqual(["harry-potter"]);
});

test("empty everything falls back to batman", () => {
	const set = savePreviewSet(cfg({ mode: "random", roster: [] }), [], []);
	expect(set).toEqual(["batman"]);
});
