import { describe, expect, test } from "bun:test";

import { PACKS } from "../../packages/core/src/packs/registry";

import { packLoadSource } from "./pack-load-source";

// Guards the web live-preview auto-wiring: the generated browser loader must cover exactly the PACKS registry,
// so a newly-registered pack (which the registry parity test ties to its on-disk dir) can never silently drop
// out of the landing page's live render.
describe("packLoadSource", () => {
	const src = packLoadSource(PACKS, "/abs/web/pack-load.ts");

	test("imports and wires every pack in PACKS", () => {
		for (const name of PACKS) {
			expect(src).toContain(`@ccsidekick/pack-${name}/pack.json`);
			expect(src).toContain(`${JSON.stringify(name)}: `);
		}
	});

	test("emits exactly one bundled pack per registry entry (no extras, no drift)", () => {
		expect((src.match(/pack\.json/g) ?? []).length).toBe(PACKS.length);
	});
});
