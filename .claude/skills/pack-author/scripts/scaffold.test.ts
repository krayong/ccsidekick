import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PLACEHOLDER_TOKEN, packageJsonErrors } from "../../../../packages/core/src";

import { scaffold } from "./scaffold";

const REGISTRY_REL = join("packages", "core", "src", "packs", "registry.ts");

function collectStrings(v: unknown, out: string[]): void {
	if (Array.isArray(v)) {
		for (const x of v) collectStrings(x, out);
	} else if (v !== null && typeof v === "object") {
		for (const x of Object.values(v)) collectStrings(x, out);
	} else if (typeof v === "string") {
		out.push(v);
	}
}

describe("scaffold", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "scaffold-"));
		mkdirSync(join(root, "packages", "core", "src", "packs"), { recursive: true });
		writeFileSync(join(root, REGISTRY_REL), 'export const PACKS = ["batman"] as const;\n');
		// The engine's package.json — scaffold links each new pack as a `workspace:*` runtime dependency here.
		writeFileSync(
			join(root, "packages", "core", "package.json"),
			`${JSON.stringify({ name: "ccsidekick", dependencies: { "@ccsidekick/pack-batman": "workspace:*" } }, null, "\t")}\n`,
		);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("creates the four files, unique placeholders, and registers the pack", () => {
		scaffold("testpack", { displayName: "Test Pack", emblem: "★", root });

		const dir = join(root, "packages", "packs", "testpack");
		for (const f of ["pack.json", "package.json", "README.md", "REVIEW.md"])
			expect(existsSync(join(dir, f))).toBe(true);

		const pack = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")) as {
			lines: unknown;
			spinnerVerbs: unknown;
			schema?: number;
			theme?: {
				hues?: number[];
				comment?: number[];
				separator?: number;
				signals?: { nominal?: number; caution?: number; critical?: number };
			};
			colors?: unknown;
		};
		expect(pack.colors).toBeUndefined();
		expect(pack.theme?.hues).toEqual([75, 147, 77, 222, 210]);
		expect(pack.theme?.comment).toEqual([75, 147, 222]);
		expect(pack.theme?.separator).toBe(147);
		expect(pack.theme?.signals?.nominal).toBe(77);
		const placeholders: string[] = [];
		collectStrings(pack.lines, placeholders);
		collectStrings(pack.spinnerVerbs, placeholders);
		expect(placeholders.length).toBeGreaterThan(0);
		expect(new Set(placeholders).size).toBe(placeholders.length); // every slot is unique
		// Every placeholder carries the sentinel so the lint gate can detect un-replaced cells.
		const idleStranger = (pack.lines as { mood: { idle: Record<string, string[]> } }).mood.idle[
			"stranger"
		]!;
		expect(idleStranger[0]!).toContain(PLACEHOLDER_TOKEN);

		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
			name: string;
			exports: Record<string, string>;
		};
		expect(pkg.name).toBe("@ccsidekick/pack-testpack");
		expect(pkg.exports["./pack.json"]).toBe("./pack.json");
		// The generated package.json clears the publish-metadata gate: complete files, repository, and a
		// non-empty author (read from the ambient git identity, not hardcoded).
		expect(packageJsonErrors(pkg, "testpack")).toEqual([]);

		const reg = readFileSync(join(root, REGISTRY_REL), "utf8");
		expect(reg).toContain('"batman"');
		expect(reg).toContain('"testpack"');

		// the new pack is linked as a workspace runtime dependency of packages/core
		const corePkg = JSON.parse(
			readFileSync(join(root, "packages", "core", "package.json"), "utf8"),
		) as { dependencies?: Record<string, string> };
		expect(corePkg.dependencies?.["@ccsidekick/pack-testpack"]).toBe("workspace:*");
	});

	test("re-running is a registry no-op and overwrites the skeleton", () => {
		scaffold("testpack", { displayName: "Test Pack", emblem: "★", root });
		const packPath = join(root, "packages", "packs", "testpack", "pack.json");
		writeFileSync(packPath, '{"marker":true}\n'); // simulate a stale skeleton

		scaffold("testpack", { displayName: "Test Pack", emblem: "★", root });

		const pack = JSON.parse(readFileSync(packPath, "utf8")) as {
			schema?: number;
			marker?: boolean;
		};
		expect(pack.marker).toBeUndefined(); // skeleton was overwritten
		expect(pack.schema).toBe(1);

		const reg = readFileSync(join(root, REGISTRY_REL), "utf8");
		expect((reg.match(/"testpack"/g) ?? []).length).toBe(1); // no duplicate entry
	});
});
