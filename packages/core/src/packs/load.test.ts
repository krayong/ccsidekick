import { join } from "node:path";

import { expect, test } from "bun:test";

import { loadPack } from "./load";

const fixturePath = (rel: string): string => join(import.meta.dir, rel);

const resolver = (spec: string): string =>
	spec.endsWith("pack.json") ? fixturePath("../../../packs/batman/pack.json") : spec;

test("loads the batman stub via an injected resolver", () => {
	const r = loadPack("batman", resolver);
	expect(r.ok).toBe(true);
	if (r.ok) expect(r.pack.name).toBe("batman");
});

test("resolves a real pack via the default import.meta.resolve resolver", () => {
	const r = loadPack("batman");
	expect(r.ok).toBe(true);
	if (r.ok) expect(r.pack.schema).toBe(1);
});

test("missing pack returns ok:false (drops figure)", () => {
	const r = loadPack("ghost", () => {
		throw new Error("not found");
	});
	expect(r.ok).toBe(false);
	if (!r.ok) expect(r.reason).toContain("resolve failed");
});

test("a missing file on disk returns ok:false", () => {
	const r = loadPack("ghost", () =>
		fixturePath("../../test/fixtures/packs/does-not-exist/pack.json"),
	);
	expect(r.ok).toBe(false);
});

test("unparseable JSON returns ok:false", () => {
	const r = loadPack("broken", () =>
		fixturePath("../../test/fixtures/packs/broken-json/pack.json"),
	);
	expect(r.ok).toBe(false);
});

test("a name outside the allowed segment is rejected without resolving", () => {
	let resolved = false;
	const r = loadPack("../evil", () => {
		resolved = true;
		return "x";
	});
	expect(r.ok).toBe(false);
	expect(resolved).toBe(false);
});

test("a pack that fails the guard returns ok:false", () => {
	const r = loadPack("future", () =>
		fixturePath("../../test/fixtures/packs/invalid-schema/pack.json"),
	);
	expect(r.ok).toBe(false);
});
