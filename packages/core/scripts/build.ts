#!/usr/bin/env bun
// Two-bundle build, run by `bun run build`. This is a build-time script (never shipped), so Bun-only APIs are
// fine here. It emits two ESM bundles into `dist/`:
//   • ccsidekick-render.js — the lean, Node-portable hot path (render + classify). SELF-CONTAINED: smol-toml and
//     the JSON data assets (pricing.json, fx-fallback.json, both static JSON imports) are inlined, and it pulls
//     in no Ink/React. This is what Claude Code spawns on every statusline tick, so it must run under plain node.
//   • ccsidekick.js — the user-facing TUI + uninstall entry. Bundles only its own code; Ink, React, React's
//     reconciler, and Yoga stay RUNTIME deps resolved from node_modules (Yoga ships wasm and does not
//     single-file-bundle), so they are marked external.
// Pack packages (@ccsidekick/pack-*) are external in BOTH bundles: a pack is data, fs-resolved at runtime via
// import.meta.resolve, never inlined. Each output gets a `#!/usr/bin/env node` shebang and is made executable.

import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const packageRoot = dirname(import.meta.dir);
const outdir = join(packageRoot, "dist");
const binDir = join(packageRoot, "src", "bin");

/** Packs are fs-resolved at runtime, never bundled — external in every build. */
const PACK_EXTERNAL = ["@ccsidekick/pack-*"];

/**
 * The TUI keeps the Ink/React runtime out of its bundle and resolves it from node_modules. Marking `ink`/`react`
 * external is enough — Bun does not recurse into an external module, so Ink's own transitive deps (React
 * reconciler, Yoga) are never pulled in and need no separate entry.
 */
const TUI_EXTERNAL = [...PACK_EXTERNAL, "ink", "react"];

async function buildBundle(entryFile: string, external: readonly string[]): Promise<void> {
	// The entry `.ts` files lead with `#!/usr/bin/env node`; Bun preserves that shebang in the bundle, so no
	// banner is added here (a banner would duplicate it). `chmod +x` below makes the outputs directly runnable.
	const result = await Bun.build({
		entrypoints: [join(binDir, entryFile)],
		outdir,
		target: "node",
		format: "esm",
		external: [...external],
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error(`build failed for ${entryFile}`);
	}
}

mkdirSync(outdir, { recursive: true });

await buildBundle("ccsidekick-render.ts", PACK_EXTERNAL);
await buildBundle("ccsidekick.ts", TUI_EXTERNAL);

for (const out of ["ccsidekick-render.js", "ccsidekick.js"]) {
	chmodSync(join(outdir, out), 0o755);
}
