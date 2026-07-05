import { expect, test } from "bun:test";

import { isAllowedPackPackage, packPackageName } from "./allowlist";

test("allowlist only accepts @ccsidekick/pack-*", () => {
	expect(isAllowedPackPackage("@ccsidekick/pack-batman")).toBe(true);
	expect(isAllowedPackPackage("evil-pkg")).toBe(false);
	expect(isAllowedPackPackage("@other/pack-x")).toBe(false);
});

test("allowlist rejects a path-traversal name segment", () => {
	expect(isAllowedPackPackage("@ccsidekick/pack-../../evil")).toBe(false);
});

test("allowlist rejects an empty or uppercase name segment", () => {
	expect(isAllowedPackPackage("@ccsidekick/pack-")).toBe(false);
	expect(isAllowedPackPackage("@ccsidekick/pack-Batman")).toBe(false);
	expect(isAllowedPackPackage("@ccsidekick/pack-a/b")).toBe(false);
});

test("packPackageName composes the scoped name", () => {
	expect(packPackageName("batman")).toBe("@ccsidekick/pack-batman");
	expect(isAllowedPackPackage(packPackageName("batman"))).toBe(true);
});
