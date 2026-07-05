// The pack installer. A blocking install would freeze Ink's render loop, so the TUI's Spinner path needs a
// non-blocking variant. This spawns `npm install <pkg> --ignore-scripts` in the engine root and resolves on exit
// 0, gated by the same first-party allowlist (packs are data, never executed code): an off-allowlist name rejects
// before any process starts. The spawn runner is injectable so tests never touch the network.

import { type ChildProcess, spawn } from "node:child_process";

import { isAllowedPackPackage, packPackageName } from "../../packs";

import { ENGINE_ROOT } from "./catalog";

export type SpawnRunner = (
	command: string,
	args: readonly string[],
	options: { readonly cwd: string; readonly stdio: ["ignore", "ignore", "pipe"] },
) => Pick<ChildProcess, "on" | "stderr">;

/**
 * Install one allowlisted pack asynchronously. Refuses any name that does not resolve to an
 * `@ccsidekick/pack-<name>` source before spawning, mirroring the sync installer's gate. Resolves on a clean exit
 * and rejects on a non-zero exit or a spawn error.
 */
export function installPackAsync(
	name: string,
	engineDir: string = ENGINE_ROOT,
	run: SpawnRunner = spawn,
): Promise<void> {
	const pkg = packPackageName(name);
	if (!isAllowedPackPackage(pkg)) {
		return Promise.reject(
			new Error(`ccsidekick: refusing to install off-allowlist pack "${name}"`),
		);
	}
	return new Promise<void>((resolve, reject) => {
		// Capture stderr (stdout stays discarded) so a failed install surfaces npm's real reason — an unpublished
		// package 404s, and a bare "exited 1" hides it. The tail is trimmed to keep the TUI error readable.
		const child = run("npm", ["install", pkg, "--ignore-scripts"], {
			cwd: engineDir,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += String(chunk);
		});
		child.on("error", (err) => {
			reject(err instanceof Error ? err : new Error(String(err)));
		});
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			const detail = stderr.trim();
			const tail = detail.length > 500 ? detail.slice(-500) : detail;
			reject(
				new Error(
					`ccsidekick: npm install ${pkg} exited ${String(code)}${tail ? `\n${tail}` : ""}`,
				),
			);
		});
	});
}
