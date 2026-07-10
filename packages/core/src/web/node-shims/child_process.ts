// Browser stand-in for `node:child_process`. There are no real subprocesses in the browser. `git` invocations are
// served from a canned per-scenario lookup the web entry installs on `vfs.gitRunner` (a pure args→stdout map, no
// subprocess behavior); every other probe (creds/keychain/usage) reports a clean failure and the render
// pipeline's source readers fall back to their "no data" results.

// eslint-disable-next-line boundaries/dependencies -- node shim reaches sibling web/vfs; the web subtree is browser-build glue with no barrel
import { vfs } from "../vfs";

interface SpawnSyncResult {
	readonly status: number | null;
	readonly signal: null;
	readonly pid: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly output: readonly (string | null)[];
	readonly error?: Error;
}

export function spawnSync(cmd: unknown, args?: readonly unknown[]): SpawnSyncResult {
	if (cmd === "git" && vfs.gitRunner !== null) {
		const raw = (args ?? []).map(String);
		// Strip the `--no-optional-locks` flag readGit always prepends, so the runner keys on the bare subcommand.
		const bare = raw[0] === "--no-optional-locks" ? raw.slice(1) : raw;
		const stdout = vfs.gitRunner(bare);
		return { status: 0, signal: null, pid: 0, stdout, stderr: "", output: [null, stdout, ""] };
	}
	const error = new Error("child_process is unavailable in the browser");
	return { status: null, signal: null, pid: 0, stdout: "", stderr: "", output: [null], error };
}

export function execFileSync(): never {
	throw new Error("child_process is unavailable in the browser");
}
