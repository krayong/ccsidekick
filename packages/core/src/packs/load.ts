// The fs-resolved pack loader. A pack is DATA, never executed code: its `pack.json` is resolved by module
// specifier (default via the ESM-stable sync `import.meta.resolve`, Node >=20.6), read with `fs`, parsed, and
// narrowed through the hand-written guard. Every step is wrapped so the loader never throws — on any failure
// (resolve, read, parse, or guard rejection) it returns `{ ok: false }` and the render pipeline drops the figure
// and leads with the `[<name>]` chip instead of crashing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PackJson } from "../domain";

import { isAllowedPackPackage, packPackageName } from "./allowlist";
import { validatePack } from "./validate";

type LoadResult = { ok: true; pack: PackJson } | { ok: false; reason: string };

const defaultResolver = (spec: string): string => fileURLToPath(import.meta.resolve(spec));

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function loadPack(
	name: string,
	resolver: (spec: string) => string = defaultResolver,
): LoadResult {
	// Validate the `<name>` segment before it reaches the resolver: an unvalidated name (e.g. `../evil`) would
	// otherwise feed a path traversal straight through `import.meta.resolve`.
	if (!isAllowedPackPackage(packPackageName(name))) {
		return { ok: false, reason: `invalid pack name: ${name}` };
	}

	const spec = `${packPackageName(name)}/pack.json`;

	let path: string;
	try {
		path = resolver(spec);
	} catch (e) {
		return { ok: false, reason: `resolve failed: ${errMessage(e)}` };
	}

	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (e) {
		return { ok: false, reason: `read failed: ${errMessage(e)}` };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch (e) {
		return { ok: false, reason: `parse failed: ${errMessage(e)}` };
	}

	const pack = validatePack(parsed);
	if (pack === null) return { ok: false, reason: "pack failed validation" };
	return { ok: true, pack };
}
