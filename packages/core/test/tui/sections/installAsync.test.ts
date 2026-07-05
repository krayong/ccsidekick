import type { ChildProcess } from "node:child_process";

import { expect, test } from "bun:test";

import { installPackAsync, type SpawnRunner } from "../../../src/tui/sections";

// A fake spawn: emits any stderr then fires "close" with the given code (or "error") on the next microtask, and
// records whether it ran.
function fakeSpawn(
	outcome: number | "error",
	stderr = "",
): { run: SpawnRunner; calls: () => number } {
	const state = { calls: 0 };
	const run: SpawnRunner = () => {
		state.calls += 1;
		const handlers: Record<string, (arg: unknown) => void> = {};
		const errHandlers: Record<string, (arg: unknown) => void> = {};
		queueMicrotask(() => {
			if (stderr) errHandlers["data"]?.(Buffer.from(stderr));
			if (outcome === "error") handlers["error"]?.(new Error("spawn boom"));
			else handlers["close"]?.(outcome);
		});
		const child = {
			stderr: {
				on(event: string, cb: (arg: never) => void): unknown {
					errHandlers[event] = cb as (arg: unknown) => void;
					return child.stderr;
				},
			},
			on(event: string, cb: (arg: never) => void): unknown {
				handlers[event] = cb as (arg: unknown) => void;
				return child;
			},
		};
		return child as unknown as Pick<ChildProcess, "on" | "stderr">;
	};
	return { run, calls: () => state.calls };
}

test("an off-allowlist name rejects without ever spawning", async () => {
	const spy = fakeSpawn(0);
	let err: unknown;
	try {
		await installPackAsync("../evil", "/engine", spy.run);
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(Error);
	expect((err as Error).message).toMatch(/off-allowlist/);
	expect(spy.calls()).toBe(0);
});

test("a child that exits 0 resolves", async () => {
	const spy = fakeSpawn(0);
	await installPackAsync("robin", "/engine", spy.run);
	expect(spy.calls()).toBe(1);
});

test("a child that exits non-zero rejects", async () => {
	const spy = fakeSpawn(1);
	let err: unknown;
	try {
		await installPackAsync("robin", "/engine", spy.run);
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(Error);
});

test("a non-zero exit surfaces npm's stderr in the rejection", async () => {
	const spy = fakeSpawn(1, "npm error code E404\nnpm error 404 Not Found - not published");
	let err: unknown;
	try {
		await installPackAsync("spiderman", "/engine", spy.run);
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(Error);
	expect((err as Error).message).toMatch(/E404/);
});

test("a spawn error rejects", async () => {
	const spy = fakeSpawn("error");
	let err: unknown;
	try {
		await installPackAsync("robin", "/engine", spy.run);
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(Error);
	expect((err as Error).message).toMatch(/boom/);
});
