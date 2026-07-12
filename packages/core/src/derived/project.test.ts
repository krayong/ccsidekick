import { expect, test } from "bun:test";

import { asProject } from "../domain";
import type { GitState, Payload } from "../sources";

import { deriveProject } from "./project";

const base: Payload = { workspace: {}, model: {} };

const git = (originRepo?: string): GitState => ({
	staged: 0,
	unstaged: 0,
	untracked: [],
	conflict: 0,
	operation: "none",
	stash: 0,
	submoduleBranches: [],
	insertions: 0,
	deletions: 0,
	changedFiles: 0,
	upstream: false,
	upstreamGone: false,
	remoteBranchExists: false,
	...(originRepo !== undefined ? { originRepo } : {}),
});

test("workspace.repo {owner,name} joins to owner/name and wins", () => {
	const payload: Payload = {
		...base,
		workspace: { repo: { host: "github.com", owner: "krayong", name: "ccsidekick" } },
	};
	expect(deriveProject(git("other/repo"), payload)).toBe(asProject("krayong/ccsidekick"));
});

test("partial workspace.repo (missing name) falls through to originRepo", () => {
	const payload: Payload = { ...base, workspace: { repo: { owner: "krayong" } } };
	expect(deriveProject(git("krayong/ccsidekick"), payload)).toBe(asProject("krayong/ccsidekick"));
});

test("originRepo merges two clones with the same remote to one key", () => {
	const a: Payload = { ...base, cwd: "/Users/me/a" };
	const b: Payload = { ...base, cwd: "/Users/me/b" };
	expect(deriveProject(git("krayong/ccsidekick"), a)).toBe(
		deriveProject(git("krayong/ccsidekick"), b),
	);
});

test("no repo info ⇒ absolute cwd path verbatim", () => {
	const payload: Payload = { ...base, cwd: "/Users/me/scratch" };
	expect(deriveProject(null, payload)).toBe(asProject("/Users/me/scratch"));
	expect(deriveProject(git(), payload)).toBe(asProject("/Users/me/scratch"));
});
