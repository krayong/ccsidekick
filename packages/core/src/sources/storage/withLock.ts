import { closeSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const STALE_MS = 30_000;

export function withLock<T>(lockPath: string, fn: () => T, readOnly: () => T): T {
	let fd: number | undefined;
	try {
		mkdirSync(dirname(lockPath), { recursive: true }); // else fresh install never creates cache/ or analytics/
	} catch {
		// Directory creation failed (e.g. read-only filesystem or unsupported path in test environments).
		// Fall through to the read-only path — same behaviour as when the lock file can't be acquired.
		return readOnly();
	}
	try {
		fd = openSync(lockPath, "wx");
	} catch {
		try {
			if (Date.now() - statSync(lockPath).mtimeMs > STALE_MS) {
				unlinkSync(lockPath);
				fd = openSync(lockPath, "wx");
			}
		} catch {
			/* still held */
		}
	}
	if (fd === undefined) return readOnly();
	try {
		closeSync(fd);
		return fn();
	} finally {
		try {
			unlinkSync(lockPath);
		} catch {
			/* best effort */
		}
	}
}
