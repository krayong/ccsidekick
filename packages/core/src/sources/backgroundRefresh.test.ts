import { expect, test } from "bun:test";

import { spawnRefresh } from "./backgroundRefresh";

test("spawnRefresh re-runs the render script as a detached `refresh` child with no stdio", () => {
	const calls: { cmd: string; args: readonly string[]; opts: unknown }[] = [];
	const events: string[] = [];
	let unrefs = 0;
	const fakeSpawn = (cmd: string, args: readonly string[], opts: unknown) => {
		calls.push({ cmd, args, opts });
		return {
			on: (event: string) => {
				events.push(event);
			},
			unref: () => {
				unrefs += 1;
			},
		};
	};

	spawnRefresh("/opt/ccsidekick-render.js", "usage", "/cfg/ccsidekick", fakeSpawn);

	expect(calls).toEqual([
		{
			cmd: process.execPath,
			args: ["/opt/ccsidekick-render.js", "refresh", "usage", "/cfg/ccsidekick"],
			// Detached + no inherited stdio: the child outlives the killed statusline process and holds no pipe
			// that would keep Claude Code waiting on the line.
			opts: { detached: true, stdio: "ignore" },
		},
	]);
	expect(events).toContain("error"); // a failed spawn is swallowed, never an uncaught `error` event
	expect(unrefs).toBe(1);
});
