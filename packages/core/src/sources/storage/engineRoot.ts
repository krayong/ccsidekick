import { fileURLToPath } from "node:url";

/**
 * The engine package root: the directory that holds the engine's `node_modules` (and its `package.json`). This is
 * where the TUI catalog installs packs and where `listInstalledPacks` scans, so every caller must agree on it.
 *
 * Computed for the SHIPPED bundle. `bun build` emits both bins into `<packageRoot>/dist/` and reports every
 * bundled module's `import.meta.url` as that output bundle path, so the package root is exactly one directory up
 * from any bundled module. Pass the caller's `import.meta.url`.
 *
 * This depth is correct ONLY in the built `dist/` bundle. Run from the `src/` tree (e.g. unit tests) the same
 * `../` lands inside `src/`, so source-run callers must inject an explicit engine dir rather than rely on this.
 */
export function engineRoot(moduleUrl: string): string {
	return fileURLToPath(new URL("../", moduleUrl));
}
