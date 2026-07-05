import { expect, test } from "bun:test";

import type { SaveTarget } from "../shell";

import { canConfirm, checkedTargets, toggleAll, toggleOne } from "./configDirSelect";

test("toggleOne adds an unchecked index", () => {
	expect([...toggleOne(new Set([0]), 2)]).toEqual([0, 2]);
});

test("toggleOne removes a checked index", () => {
	expect([...toggleOne(new Set([0, 2]), 2)]).toEqual([0]);
});

test("toggleAll checks every index when not all are checked", () => {
	expect([...toggleAll(new Set([1]), 3)]).toEqual([0, 1, 2]);
});

test("toggleAll clears when all are already checked", () => {
	expect([...toggleAll(new Set([0, 1, 2]), 3)]).toEqual([]);
});

test("canConfirm is false for an empty selection", () => {
	expect(canConfirm(new Set())).toBe(false);
	expect(canConfirm(new Set([0]))).toBe(true);
});

test("checkedTargets returns the checked targets in order", () => {
	const a: SaveTarget = { dir: "/a", scope: "global" };
	const b: SaveTarget = { dir: "/b", scope: "global" };
	const c: SaveTarget = { dir: "/c", scope: "local", cwd: "/c" };
	expect(checkedTargets([a, b, c], new Set([2, 0]))).toEqual([a, c]);
});
