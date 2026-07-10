// Browser stand-in for `node:path` (posix semantics only — the browser has no Windows paths). Pure string ops;
// enough of the surface for the render path's join/dirname/basename/resolve/delimiter callers.

export const delimiter = ":";
export const sep = "/";

function normalizeArray(parts: string[]): string[] {
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out;
}

export function join(...parts: string[]): string {
	const joined = parts.filter((p) => p.length > 0).join("/");
	if (joined === "") return ".";
	const lead = joined.startsWith("/") ? "/" : "";
	return lead + normalizeArray(joined.split("/")).join("/");
}

export function resolve(...parts: string[]): string {
	let resolved = "";
	let isAbsolute = false;
	for (let i = parts.length - 1; i >= 0 && !isAbsolute; i -= 1) {
		const part = parts[i] ?? "";
		if (part === "") continue;
		resolved = `${part}/${resolved}`;
		isAbsolute = part.startsWith("/");
	}
	const normalized = normalizeArray(resolved.split("/")).join("/");
	return isAbsolute ? `/${normalized}` : normalized || ".";
}

export function dirname(path: string): string {
	const idx = path.replace(/\/+$/, "").lastIndexOf("/");
	if (idx < 0) return ".";
	if (idx === 0) return "/";
	return path.slice(0, idx);
}

export function basename(path: string, ext?: string): string {
	const base = path.replace(/\/+$/, "").split("/").pop() ?? "";
	return ext !== undefined && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}
