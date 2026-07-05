import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { FIRST_PARTY_PACKS } from "./registry";

test("registry matches packages/packs/* directories", () => {
	const dir = join(import.meta.dir, "../../../packs");
	const dirs = readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
	expect([...dirs].sort()).toEqual([...FIRST_PARTY_PACKS].sort());
});
