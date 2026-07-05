import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { listInstalledPacks } from "./installed";

function engineWith(packs: readonly string[], extra: readonly string[] = []): string {
	const engine = mkdtempSync(join(tmpdir(), "ccsk-eng-"));
	const scope = join(engine, "node_modules", "@ccsidekick");
	mkdirSync(scope, { recursive: true });
	for (const p of packs) mkdirSync(join(scope, p));
	for (const f of extra) writeFileSync(join(scope, f), "x");
	return engine;
}

test("enumerates pack-* dirs, stripping the prefix, sorted", () => {
	const engine = engineWith(["pack-robin", "pack-batman", "core-utils"], ["pack-stray.txt"]);
	try {
		expect(listInstalledPacks(engine)).toEqual(["batman", "robin"]);
	} finally {
		rmSync(engine, { recursive: true, force: true });
	}
});

test("detects symlinked pack dirs (workspace links) that resolve to a directory", () => {
	const engine = mkdtempSync(join(tmpdir(), "ccsk-eng-"));
	const scope = join(engine, "node_modules", "@ccsidekick");
	mkdirSync(scope, { recursive: true });
	const target = mkdtempSync(join(tmpdir(), "ccsk-pack-"));
	symlinkSync(target, join(scope, "pack-spiderman"), "dir");
	const dangling = join(mkdtempSync(join(tmpdir(), "ccsk-gone-")), "removed");
	symlinkSync(dangling, join(scope, "pack-ghost"), "dir");
	try {
		expect(listInstalledPacks(engine)).toEqual(["spiderman"]);
	} finally {
		rmSync(engine, { recursive: true, force: true });
		rmSync(target, { recursive: true, force: true });
	}
});

test("missing scope dir ⇒ empty list", () => {
	const engine = mkdtempSync(join(tmpdir(), "ccsk-eng-"));
	try {
		expect(listInstalledPacks(engine)).toEqual([]);
	} finally {
		rmSync(engine, { recursive: true, force: true });
	}
});
