import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function atomicWrite(path: string, data: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
}
