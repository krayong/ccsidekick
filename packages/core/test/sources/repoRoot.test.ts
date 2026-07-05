import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { repoRootForCwd } from "../../src/sources";

test("a subdirectory resolves to the repo root (nearest ancestor with a .git directory)", () => {
	const repo = mkdtempSync(join(tmpdir(), "rr-repo-"));
	mkdirSync(join(repo, ".git"));
	const sub = join(repo, "docs", "superpowers", "plans");
	mkdirSync(sub, { recursive: true });
	expect(repoRootForCwd(sub)).toBe(repo);
});

test("an in-repo worktree (its .git is a FILE) resolves to the main repo root", () => {
	const repo = mkdtempSync(join(tmpdir(), "rr-wt-"));
	mkdirSync(join(repo, ".git"));
	const wt = join(repo, ".claude", "worktrees", "agent", "abc123");
	mkdirSync(wt, { recursive: true });
	writeFileSync(join(wt, ".git"), "gitdir: /somewhere/else\n"); // worktree marker file, not a dir
	expect(repoRootForCwd(wt)).toBe(repo);
});

test("a path under no repo is returned unchanged", () => {
	const plain = mkdtempSync(join(tmpdir(), "rr-plain-"));
	expect(repoRootForCwd(plain)).toBe(plain);
});
