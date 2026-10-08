import { spawn } from "node:child_process";

/** The network caches the render refreshes in the background. */
export type RefreshKind = "usage" | "fx";

/** Runs a claimed refresh of `kind` against the state `root`. */
export type StartRefresh = (kind: RefreshKind, root: string) => void;

interface DetachedChild {
	on(event: "error", listener: () => void): unknown;
	unref(): void;
}

type SpawnDetached = (
	cmd: string,
	args: readonly string[],
	opts: { detached: true; stdio: "ignore" },
) => DetachedChild;

/**
 * Re-run the render `script` as `<script> refresh <kind> <root>` in a detached child. Claude Code kills the
 * statusline process soon after the line is printed, before a network fetch can land, so the fetch has to run
 * in a process of its own: detached so it outlives the parent, with no stdio so it holds no pipe that would keep
 * Claude Code waiting on the line. A failed spawn is swallowed; the claimed slot then lapses at its TTL.
 */
export function spawnRefresh(
	script: string,
	kind: RefreshKind,
	root: string,
	spawnImpl: SpawnDetached = spawn,
): void {
	const child = spawnImpl(process.execPath, [script, "refresh", kind, root], {
		detached: true,
		stdio: "ignore",
	});
	child.on("error", () => {
		/* never surface a spawn failure */
	});
	child.unref();
}
