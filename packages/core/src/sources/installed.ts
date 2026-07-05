import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "pack-";

/**
 * Enumerate installed pack ids by scanning `node_modules/@ccsidekick/` for `pack-*` package directories,
 * returning the id (the prefix stripped), sorted. Feeds the render-path random-with-empty-roster pick and the
 * setup TUI character catalog. Never throws.
 *
 * A workspace install symlinks each pack dir (Bun links `@ccsidekick/pack-*` to `packages/packs/*`), and
 * `withFileTypes` reports a symlink as `isSymbolicLink()`, not `isDirectory()` — so a symlinked entry is followed
 * with `statSync` (which resolves the link) and counted when it lands on a directory; a dangling link is skipped.
 */
export function listInstalledPacks(engineDir: string): string[] {
	const scope = join(engineDir, "node_modules", "@ccsidekick");
	let entries: Dirent[];
	try {
		entries = readdirSync(scope, { withFileTypes: true });
	} catch {
		return [];
	}
	const ids: string[] = [];
	for (const entry of entries) {
		if (!entry.name.startsWith(PREFIX) || entry.name.length <= PREFIX.length) continue;
		if (!isDir(entry, join(scope, entry.name))) continue;
		ids.push(entry.name.slice(PREFIX.length));
	}
	return ids.sort();
}

/** A directory entry, following a symlink to its target; a dangling or unreadable link is not a directory. */
function isDir(entry: Dirent, path: string): boolean {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
