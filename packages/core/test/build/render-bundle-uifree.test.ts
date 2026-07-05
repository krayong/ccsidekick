import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, expect, test } from "bun:test";

const packageRoot = join(import.meta.dir, "../..");
const renderBundle = join(packageRoot, "dist", "ccsidekick-render.js");

beforeAll(() => {
	const built = spawnSync("bun", ["scripts/build.ts"], { cwd: packageRoot, stdio: "inherit" });
	expect(built.status).toBe(0);
});

test("the render bundle inlines no Ink or React runtime", () => {
	const src = readFileSync(renderBundle, "utf8");
	// The UI runtimes must never reach the hot-path bundle. The six source-literal patterns below catch
	// dynamic-require / import-statement pathways that survive bundling as-is. They do NOT catch the primary
	// threat: when Bun fully inlines React (e.g. from `import "react"` in source), it strips the import
	// declaration and emits React's compiled source directly — no import string survives in the output.
	//
	// The inlined-React signal we rely on instead:
	//   • "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED" — React's own internal sentinel, emitted
	//     verbatim into every React bundle (verified: present in react-polluted bundle, absent from clean bundle).
	//   • "node_modules/react/" — Bun emits a path comment header (e.g. "// ../../node_modules/.bun/react@x.y.z/
	//     node_modules/react/...") when it inlines a module from node_modules (verified: same empirical check).
	//
	// @inkjs/ui is listed now (passes vacuously until that dependency arrives) so the guard is complete before
	// any code can import it.
	expect(src).not.toContain("__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED");
	expect(src).not.toContain("node_modules/react/");
	expect(src).not.toContain("react-reconciler");
	expect(src).not.toContain("@inkjs/ui");
	expect(src).not.toMatch(/from\s*["']ink["']/);
	expect(src).not.toMatch(/from\s*["']react["']/);
	expect(src).not.toMatch(/require\(["']ink["']\)/);
	expect(src).not.toMatch(/require\(["']react["']\)/);
});
