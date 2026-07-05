import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "bun:test";

import { engineRoot, listInstalledPacks } from "../../src/sources";

// The catalog's default install target is `ENGINE_ROOT = engineRoot(import.meta.url)` — the engine package root
// whose `node_modules` listInstalledPacks/loadPack resolve from, never the user's cwd. In the shipped artifact
// the catalog is bundled into `<packageRoot>/dist`, so the root is one level up from the bundle. Source-run
// `import.meta.url` points into `src/`, so this exercises the resolver against a simulated dist URL rather than
// the live module constant (whose source-run value is intentionally bundle-only).

/** A throwaway engine layout: a bundle at `<root>/dist/<bin>.js` and a pack installed under `node_modules`. */
function distEngine(): { root: string; distUrl: string } {
	const root = mkdtempSync(join(tmpdir(), "ccsk-catalog-root-"));
	mkdirSync(join(root, "node_modules", "@ccsidekick", "pack-batman"), { recursive: true });
	mkdirSync(join(root, "dist"), { recursive: true });
	return { root, distUrl: pathToFileURL(join(root, "dist", "ccsidekick.js")).href };
}

test("the catalog install target resolves to the engine package root (the node_modules holder)", () => {
	const { root, distUrl } = distEngine();
	try {
		expect(engineRoot(distUrl)).toBe(`${root}/`);
		// A pack installed at that root is then discoverable — the install-on-select contract.
		expect(listInstalledPacks(engineRoot(distUrl))).toEqual(["batman"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the catalog install target is independent of process.cwd()", () => {
	const { root, distUrl } = distEngine();
	const original = process.cwd();
	try {
		process.chdir("/");
		expect(engineRoot(distUrl)).toBe(`${root}/`);
		expect(engineRoot(distUrl)).not.toBe("/");
	} finally {
		process.chdir(original);
		rmSync(root, { recursive: true, force: true });
	}
});
