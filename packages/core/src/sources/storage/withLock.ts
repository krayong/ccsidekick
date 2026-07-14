import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from "node:fs";
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
		// Contended. Reclaim only a lock older than STALE_MS, and do it atomically: rename the stale file
		// aside first. `renameSync` is atomic, so if two processes both see the lock as stale and both race to
		// reclaim it, only one finds the source to rename — the rest get ENOENT and fall through to readOnly.
		// (The prior unlink-then-recreate let both unlink and both recreate, yielding two "holders" and a lost
		// update.) The winner then creates a fresh lock and clears the sidecar.
		try {
			if (Date.now() - statSync(lockPath).mtimeMs > STALE_MS) {
				const aside = `${lockPath}.stale`;
				renameSync(lockPath, aside);
				fd = openSync(lockPath, "wx");
				try {
					unlinkSync(aside);
				} catch {
					/* best effort: a leftover sidecar is harmless and overwritten by the next reclaim */
				}
			}
		} catch {
			/* still held, or lost the reclaim race (ENOENT on the rename) */
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
