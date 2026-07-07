import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { PACKS } from "./registry";

const PACKS_DIR = join(import.meta.dir, "../../../packs");
const CORE_PKG = join(import.meta.dir, "../../package.json");

// A directory is a shippable pack only once it has a pack.json; half-authored dirs (holding just `.author/`
// scratch) are ignored, so authoring a pack in-tree never breaks the build.
function packDirs(): readonly string[] {
	return readdirSync(PACKS_DIR).filter(
		(e) =>
			statSync(join(PACKS_DIR, e)).isDirectory() &&
			existsSync(join(PACKS_DIR, e, "pack.json")),
	);
}

test("registry matches the on-disk pack dirs", () => {
	expect([...packDirs()].sort()).toEqual([...PACKS].sort());
});

test("every pack is a runtime dependency of the engine", () => {
	const pkg = JSON.parse(readFileSync(CORE_PKG, "utf8")) as {
		dependencies?: Record<string, string>;
	};
	const deps = pkg.dependencies ?? {};
	for (const name of PACKS) {
		expect(deps[`@ccsidekick/pack-${name}`]).toBeDefined();
	}
});

test("the default character (batman) is registered", () => {
	expect(PACKS).toContain("batman");
});
