import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { atomicWrite } from "./atomicWrite";

export function appendBounded(path: string, line: string, max: number): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${line}\n`);
	const lines = readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.length > 0);
	// The over-cap rewrite goes through atomicWrite (tmp + rename) so a concurrent reader sees the whole old or
	// whole new log, never a truncated file mid-write.
	if (lines.length > max) atomicWrite(path, `${lines.slice(-max).join("\n")}\n`);
}
