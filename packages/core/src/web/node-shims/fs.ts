// Browser stand-in for `node:fs`, aliased in at build time. There is no filesystem in the browser, so reads are
// served from the in-memory `vfs` (the global `config.toml` plus the demo transcript tree the web entry stashes);
// anything else degrades to "absent" (the render pipeline's source readers already treat a missing file as empty)
// and every write is a no-op (the best-effort `persist` tail is never invoked from the web entry).

// eslint-disable-next-line boundaries/dependencies -- node shim reaches sibling web/vfs; the web subtree is browser-build glue with no barrel
import { vfs } from "../vfs";

function enoent(path: unknown): never {
	throw Object.assign(new Error(`ENOENT: no such file (web shim): ${String(path)}`), {
		code: "ENOENT",
	});
}

const isFile = (p: string): boolean => vfs.files.has(p);

/** A virtual dir exists when some virtual file lives under it. */
function isDir(p: string): boolean {
	const prefix = p.endsWith("/") ? p : `${p}/`;
	for (const key of vfs.files.keys()) if (key.startsWith(prefix)) return true;
	return false;
}

/** The immediate child names (files and sub-dirs) directly under `dir`. */
function children(dir: string): string[] {
	const prefix = dir.endsWith("/") ? dir : `${dir}/`;
	const names = new Set<string>();
	for (const key of vfs.files.keys()) {
		if (!key.startsWith(prefix)) continue;
		const seg = key.slice(prefix.length).split("/")[0];
		if (seg !== undefined && seg !== "") names.add(seg);
	}
	return [...names];
}

interface Stat {
	readonly mtimeMs: number;
	readonly size: number;
	isDirectory(): boolean;
	isFile(): boolean;
}

export function readFileSync(path: unknown): string {
	const p = String(path);
	// The project override (`<dir>/.ccsidekick/config.toml`) is always empty; the global one carries our config.
	if (p.endsWith(`.ccsidekick/config.toml`)) return "";
	const file = vfs.files.get(p);
	if (file !== undefined) return file;
	if (p.endsWith("config.toml")) return vfs.configToml;
	return enoent(path);
}

export function existsSync(path: unknown): boolean {
	const p = String(path);
	return isFile(p) || isDir(p);
}

export function readdirSync(path: unknown): string[] {
	const p = String(path);
	return isDir(p) ? children(p) : [];
}

export function statSync(path: unknown): Stat {
	const p = String(path);
	const file = vfs.files.get(p);
	if (file !== undefined) {
		return { mtimeMs: 1, size: file.length, isDirectory: () => false, isFile: () => true };
	}
	if (isDir(p)) return { mtimeMs: 1, size: 0, isDirectory: () => true, isFile: () => false };
	return enoent(path);
}

export function realpathSync(path: unknown): string {
	return String(path);
}

/* Writers: no-ops. The web entry never runs the persist tail, but these must resolve for the bundle to link. */
export function writeFileSync(): void {}
export function appendFileSync(): void {}
export function mkdirSync(): void {}
export function renameSync(): void {}
export function rmSync(): void {}
export function unlinkSync(): void {}
export function utimesSync(): void {}
export function closeSync(): void {}
export function openSync(path: unknown): never {
	return enoent(path);
}
