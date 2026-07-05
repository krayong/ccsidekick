import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, test } from "bun:test";

import { listInstalledPacks } from "..";

import { engineRoot } from "./engineRoot";

// Dist-layout regression. The shipped artifact bundles both bins into `<packageRoot>/dist/`, and `bun build`
// reports every bundled module's `import.meta.url` as that output bundle path. So the engine package root — the
// dir holding `node_modules` — is exactly one level up from the bundle. Source-run unit tests never see this:
// their `import.meta.url` points into `src/`, where the old inline depths (`../../`, `../../../`) happened to
// reach the package root, which is why the bug only surfaced in the built `dist/` artifact. These tests simulate
// the dist-located URL against a fixture tree so the depth math is exercised the way it ships.

/** A throwaway engine layout: a bundle at `<root>/dist/<bin>.js` and packs installed under `node_modules`. */
function distEngine(): { root: string; distUrl: string } {
	const root = mkdtempSync(join(tmpdir(), "ccsk-engine-root-"));
	mkdirSync(join(root, "node_modules", "@ccsidekick", "pack-batman"), { recursive: true });
	mkdirSync(join(root, "node_modules", "@ccsidekick", "pack-robin"), { recursive: true });
	mkdirSync(join(root, "dist"), { recursive: true });
	return { root, distUrl: pathToFileURL(join(root, "dist", "ccsidekick.js")).href };
}

test("engineRoot resolves the package root (the node_modules holder) from a dist-located bundle URL", () => {
	const { root, distUrl } = distEngine();
	try {
		expect(engineRoot(distUrl)).toBe(`${root}/`);
		// The correct root finds the packs the catalog installed there — the behavior the bug silently lost.
		expect(listInstalledPacks(engineRoot(distUrl))).toEqual(["batman", "robin"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the pre-fix overshooting depths miss packs installed in the dist-layout root", () => {
	const { root, distUrl } = distEngine();
	try {
		// render/save shipped `../../` from the bundle ⇒ one level above the package root ⇒ no packs.
		expect(listInstalledPacks(fileURLToPath(new URL("../../", distUrl)))).toEqual([]);
		// catalog shipped `../../../` ⇒ two levels above ⇒ also empty.
		expect(listInstalledPacks(fileURLToPath(new URL("../../../", distUrl)))).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("engineRoot is a pure function of the URL — independent of process.cwd()", () => {
	const { root, distUrl } = distEngine();
	const original = process.cwd();
	try {
		process.chdir("/");
		expect(engineRoot(distUrl)).toBe(`${root}/`);
	} finally {
		process.chdir(original);
		rmSync(root, { recursive: true, force: true });
	}
});
