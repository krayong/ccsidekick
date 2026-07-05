import { mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function singleFlight(stampPath: string, ttlMs: number, now: number): boolean {
	try {
		if (now - statSync(stampPath).mtimeMs <= ttlMs) return false;
	} catch {
		/* no stamp yet ⇒ proceed */
	}
	try {
		mkdirSync(dirname(stampPath), { recursive: true }); // else first-ever refresh never fires when cache/ absent
		writeFileSync(stampPath, String(now));
		return true;
	} catch {
		return false;
	}
}

/**
 * After a failed refresh, roll a claimed stamp back so it suppresses retry for only `backoffMs` instead of the
 * caller's full `ttlMs`. `singleFlight` gates on the stamp's mtime, so backdating it to `now - ttlMs + backoffMs`
 * makes the slot free again once `backoffMs` has elapsed. Best-effort; a missing stamp or utimes error is ignored.
 */
export function backoffStamp(
	stampPath: string,
	ttlMs: number,
	backoffMs: number,
	now: number,
): void {
	const seconds = (now - ttlMs + backoffMs) / 1000; // utimesSync numeric times are epoch SECONDS
	try {
		utimesSync(stampPath, seconds, seconds);
	} catch {
		/* no stamp to roll back ⇒ nothing to do */
	}
}
