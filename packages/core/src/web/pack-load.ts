// Browser pack loader. The real loader (`packs/load`) resolves each `pack.json` off disk via
// `import.meta.resolve` + `fs`, which the browser has neither of. The web build replaces `packs/load` with a
// module generated from the `PACKS` registry (by `scripts/website/build-render-web.ts`) that statically imports
// every bundled pack's JSON into a name→data map and passes it to this factory. The map is run through the SAME
// `validatePack` guard the real loader uses, so validation stays authoritative and only the file-resolution step
// is replaced. Because the map is derived from `PACKS`, a new pack auto-wires into the web preview with no edit
// here.

import type { PackJson } from "../domain";
import { isAllowedPackPackage, packPackageName, validatePack } from "../packs";

type LoadResult = { ok: true; pack: PackJson } | { ok: false; reason: string };

/** Build a browser `loadPack` over a bundled name→pack-JSON map (generated from `PACKS` at build time). */
export function makeLoadPack(
	raw: Readonly<Record<string, unknown>>,
): (name: string, resolver?: (spec: string) => string) => LoadResult {
	return function loadPack(name: string, _resolver?: (spec: string) => string): LoadResult {
		void _resolver;
		if (!isAllowedPackPackage(packPackageName(name))) {
			return { ok: false, reason: `invalid pack name: ${name}` };
		}
		const data = raw[name];
		if (data === undefined) return { ok: false, reason: `pack not bundled: ${name}` };
		const pack = validatePack(data);
		if (pack === null) return { ok: false, reason: "pack failed validation" };
		return { ok: true, pack };
	};
}
