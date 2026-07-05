// The character catalog's install target. Selecting an uninstalled pack installs it through the allowlist gate
// with `--ignore-scripts` (packs are data, never executed code) — see `installAsync.ts` for the installer itself.

import { engineRoot } from "../../sources";

/**
 * The engine package root (the dir holding the engine's `node_modules`). Installing a pack here is what makes
 * `listInstalledPacks`/`loadPack` — which resolve from this same root — find it; installing into the user's cwd
 * would silently never resolve. `engineRoot` derives it from the shipped bundle location, the same root the
 * render and save paths scan.
 */
export const ENGINE_ROOT = engineRoot(import.meta.url);
