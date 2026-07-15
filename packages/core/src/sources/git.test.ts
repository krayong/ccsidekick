import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { normalizeOriginRepo, readGit } from "./git";

const STATUS_V2 = [
	"# branch.oid 0123abc",
	"# branch.head main",
	"# branch.upstream origin/main",
	"# branch.ab +3 -2",
	"# stash 1",
	"1 .M N... 100644 100644 100644 0123 0123 a.ts", // unstaged modify (XY=" M")
	"u UU N... 100644 100644 100644 100644 0123 0123 0123 c.ts", // unmerged conflict
	"? b.ts", // untracked
].join("\n");

test("batches the three rev-parse probes into one subprocess call", () => {
	const calls: string[] = [];
	const run = (args: string[]): string => {
		calls.push(args.join(" "));
		if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
			return "true\n/repo/.git\n/repo";
		}
		return "";
	};
	readGit("/repo", run);
	// The inside-work-tree / git-dir / show-toplevel probes are a single rev-parse invocation, not three.
	expect(calls).toContain("rev-parse --is-inside-work-tree --git-dir --show-toplevel");
	expect(calls).not.toContain("rev-parse --git-dir");
	expect(calls).not.toContain("rev-parse --show-toplevel");
});

test("parses injected porcelain=v2 output", () => {
	const responses: Record<string, string> = {
		"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
		"status --porcelain=v2 --branch --show-stash": STATUS_V2,
		"remote get-url origin": "git@github.com:owner/repo.git",
		"symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
		"log -1 --format=%ct": "1700000000",
	};
	const run = (args: string[]): string => responses[args.join(" ")] ?? "";
	const g = readGit("/repo", run);
	expect(g?.branch).toBe("main");
	expect(g?.behind).toBe(2);
	expect(g?.ahead).toBe(3);
	expect(g?.untracked).toContain("b.ts");
	expect(g?.conflict).toBe(1);
	expect(g?.stash).toBe(1);
	expect(g?.originRepo).toBe("owner/repo");
	expect(g?.defaultBranch).toBe("main");
});

test("detached HEAD: branch.head (detached) ⇒ sha from branch.oid, no upstream", () => {
	const detached = ["# branch.oid deadbeef", "# branch.head (detached)", "# stash 0"].join("\n");
	const run = (args: string[]): string =>
		({
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
			"status --porcelain=v2 --branch --show-stash": detached,
		})[args.join(" ")] ?? "";
	const g = readGit("/repo", run);
	expect(g?.branch).toBeUndefined();
	expect(g?.sha).toBe("deadbeef");
	expect(g?.upstreamGone).toBe(false);
});

test("no upstream: absent branch.upstream ⇒ ahead/behind undefined, not gone", () => {
	const noUp = ["# branch.oid 0123", "# branch.head feature", "# stash 0"].join("\n");
	const run = (args: string[]): string =>
		({
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
			"status --porcelain=v2 --branch --show-stash": noUp,
		})[args.join(" ")] ?? "";
	const g = readGit("/repo", run);
	expect(g?.ahead).toBeUndefined();
	expect(g?.behind).toBeUndefined();
	expect(g?.upstreamGone).toBe(false);
	expect(g?.remoteBranchExists).toBe(false);
});

test("no upstream but remote-tracking ref present ⇒ remoteBranchExists true (pushed without -u)", () => {
	const noUp = ["# branch.oid 0123", "# branch.head kv/super-filters", "# stash 0"].join("\n");
	const run = (args: string[]): string =>
		({
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
			"status --porcelain=v2 --branch --show-stash": noUp,
			"rev-parse --verify --quiet refs/remotes/origin/kv/super-filters": "56ed94c",
		})[args.join(" ")] ?? "";
	const g = readGit("/repo", run);
	expect(g?.upstream).toBe(false);
	expect(g?.remoteBranchExists).toBe(true);
});

test("upstream present but ab unresolved ⇒ gone", () => {
	const gone = [
		"# branch.oid 0123",
		"# branch.head feature",
		"# branch.upstream origin/feature",
		"# stash 0",
	].join("\n");
	const run = (args: string[]): string =>
		({
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
			"status --porcelain=v2 --branch --show-stash": gone,
		})[args.join(" ")] ?? "";
	const g = readGit("/repo", run);
	expect(g?.upstream).toBe(true);
	expect(g?.upstreamGone).toBe(true);
});

test("MM increments both staged and unstaged; rename + paths-with-spaces", () => {
	const out = [
		"# branch.oid 0",
		"# branch.head main",
		"# stash 0",
		"1 MM N... 100644 100644 100644 0 0 both staged.ts",
		"1 M. N... 100644 100644 100644 0 0 staged-only.ts",
		"2 R. N... 100644 100644 100644 0 0 R100 new name.ts\told name.ts",
	].join("\n");
	const run = (args: string[]): string =>
		({
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
			"status --porcelain=v2 --branch --show-stash": out,
		})[args.join(" ")] ?? "";
	const g = readGit("/repo", run);
	// MM → staged+unstaged; M. → staged; R. → staged. unstaged from MM only.
	expect(g?.staged).toBe(3);
	expect(g?.unstaged).toBe(1);
	expect(g?.conflict).toBe(0);
});

test("behindDefault counts HEAD..origin/<default>, preferring the remote ref", () => {
	const feature = ["# branch.oid 0123", "# branch.head feature", "# stash 0"].join("\n");
	const responses: Record<string, string> = {
		"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
		"status --porcelain=v2 --branch --show-stash": feature,
		"symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
		"rev-parse --verify --quiet refs/remotes/origin/main": "abc123",
		"rev-list --count HEAD..origin/main": "7",
	};
	const g = readGit("/repo", (a) => responses[a.join(" ")] ?? "");
	expect(g?.behindDefault).toBe(7);
});

test("behindDefault is undefined on the default branch itself", () => {
	const onMain = ["# branch.oid 0123", "# branch.head main", "# stash 0"].join("\n");
	const responses: Record<string, string> = {
		"rev-parse --is-inside-work-tree --git-dir --show-toplevel": "true\n/repo/.git",
		"status --porcelain=v2 --branch --show-stash": onMain,
		"symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
		"rev-list --count HEAD..origin/main": "7",
	};
	const g = readGit("/repo", (a) => responses[a.join(" ")] ?? "");
	expect(g?.behindDefault).toBeUndefined();
});

test("uninitializedSubmodule reads the first `-` line of git submodule status", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-git-sm-"));
	try {
		writeFileSync(join(root, ".gitmodules"), '[submodule "a"]\n\tpath = sub\n\turl = ./a\n');
		const responses: Record<string, string> = {
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": `true\n${join(root, ".git")}\n${root}`,
			"status --porcelain=v2 --branch --show-stash": "# branch.head main\n# stash 0",
			"submodule status --recursive": "-deadbeef sub\n",
		};
		const g = readGit(root, (a) => responses[a.join(" ")] ?? "");
		expect(g?.uninitializedSubmodule).toBe("sub");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("uninitializedSubmodule is undefined when all submodules are checked out", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-git-sm-"));
	try {
		writeFileSync(join(root, ".gitmodules"), '[submodule "a"]\n\tpath = sub\n\turl = ./a\n');
		const responses: Record<string, string> = {
			"rev-parse --is-inside-work-tree --git-dir --show-toplevel": `true\n${join(root, ".git")}\n${root}`,
			"status --porcelain=v2 --branch --show-stash": "# branch.head main\n# stash 0",
			"submodule status --recursive": " deadbeef sub (v1.0)\n",
		};
		const g = readGit(root, (a) => responses[a.join(" ")] ?? "");
		expect(g?.uninitializedSubmodule).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("non-repo returns null", () => {
	expect(readGit("/x", () => "false")).toBeNull();
	expect(readGit("/x", () => "")).toBeNull();
});

test("normalizeOriginRepo handles every remote form", () => {
	expect(normalizeOriginRepo("git@github.com:owner/repo.git")).toBe("owner/repo");
	expect(normalizeOriginRepo("https://github.com/owner/repo.git")).toBe("owner/repo");
	expect(normalizeOriginRepo("https://github.com/owner/repo")).toBe("owner/repo");
	expect(normalizeOriginRepo("ssh://git@host:22/owner/repo")).toBe("owner/repo");
	expect(normalizeOriginRepo("https://gitlab.com/group/sub/repo.git")).toBe("group/sub/repo");
	expect(normalizeOriginRepo("file:///srv/git/repo.git")).toBeUndefined();
	expect(normalizeOriginRepo("/srv/git/repo.git")).toBeUndefined();
	expect(normalizeOriginRepo("")).toBeUndefined();
});

// --- Real-repo integration ---------------------------------------------------

function git(cwd: string, ...args: string[]): string {
	// Strip git's own env (leaked when this suite runs inside a git hook) so each `git` acts on `cwd`,
	// not the outer repo — `GIT_DIR`/`GIT_INDEX_FILE`/`GIT_WORK_TREE` would otherwise break `worktree add`.
	const env: NodeJS.ProcessEnv = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
	);
	env["GIT_CONFIG_GLOBAL"] = "/dev/null";
	env["GIT_CONFIG_SYSTEM"] = "/dev/null";
	return execFileSync("git", args, { cwd, encoding: "utf8", env });
}

function initRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-git-"));
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "t@t.t");
	git(dir, "config", "user.name", "t");
	git(dir, "commit", "-q", "--allow-empty", "-m", "first");
	return dir;
}

test("real repo: clean state, branch, last commit, default branch", () => {
	const dir = initRepo();
	try {
		const g = readGit(dir);
		expect(g).not.toBeNull();
		expect(g?.branch).toBe("main");
		expect(g?.staged).toBe(0);
		expect(g?.unstaged).toBe(0);
		expect(g?.untracked).toEqual([]);
		expect(g?.conflict).toBe(0);
		expect(g?.operation).toBe("none");
		expect(g?.stash).toBe(0);
		expect(g?.submoduleBranches).toEqual([]);
		expect(g?.defaultBranch).toBe("main"); // no remote ⇒ verified refs/heads/main
		expect(g?.originRepo).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: staged, untracked, stash counts", () => {
	const dir = initRepo();
	try {
		writeFileSync(join(dir, "tracked.ts"), "a");
		git(dir, "add", "tracked.ts");
		writeFileSync(join(dir, "unt1.ts"), "u");
		writeFileSync(join(dir, "untracked file.ts"), "u"); // path with space
		const g = readGit(dir);
		expect(g?.staged).toBe(1);
		expect([...(g?.untracked ?? [])].sort()).toEqual(["untracked file.ts", "unt1.ts"].sort());

		// create a stash
		git(dir, "commit", "-q", "-m", "add tracked");
		writeFileSync(join(dir, "tracked.ts"), "changed");
		git(dir, "stash", "-q");
		const g2 = readGit(dir);
		expect(g2?.stash).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: merge in-progress operation detected", () => {
	const dir = initRepo();
	try {
		writeFileSync(join(dir, "f.ts"), "base\n");
		git(dir, "add", "f.ts");
		git(dir, "commit", "-q", "-m", "base");
		git(dir, "checkout", "-q", "-b", "side");
		writeFileSync(join(dir, "f.ts"), "side\n");
		git(dir, "commit", "-q", "-am", "side");
		git(dir, "checkout", "-q", "main");
		writeFileSync(join(dir, "f.ts"), "main\n");
		git(dir, "commit", "-q", "-am", "main");
		try {
			git(dir, "merge", "side"); // conflicts, leaves MERGE_HEAD
		} catch {
			/* expected non-zero on conflict */
		}
		const g = readGit(dir);
		expect(g?.operation).toBe("merge");
		expect(g?.conflict).toBeGreaterThanOrEqual(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: mainRoot resolves in a linked worktree", () => {
	const dir = initRepo();
	const wtParent = mkdtempSync(join(tmpdir(), "ccsk-git-wt-"));
	const wt = join(wtParent, "linked");
	try {
		writeFileSync(join(dir, ".gitmodules"), '[submodule "a"]\n\tpath = a\n\turl = ./a\n');
		git(dir, "add", ".gitmodules");
		git(dir, "commit", "-q", "-m", "add gitmodules");
		git(dir, "worktree", "add", "-q", wt, "-b", "linked");
		const g = readGit(wt);
		expect(g?.worktree).toBe("linked"); // confirms a linked worktree (git dir under .git/worktrees)
		// The dir field uses mainRoot: the primary checkout, not the worktree's own deep toplevel.
		expect(g?.root?.endsWith("/linked")).toBe(true); // work-tree root is the worktree itself
		expect(g?.mainRoot).toBeDefined();
		expect(g?.mainRoot?.endsWith("/linked")).toBe(false); // main root is the primary checkout
		expect(g?.mainRoot).not.toBe(g?.root);
	} finally {
		rmSync(wtParent, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: line diffstat sums staged + unstaged insertions/deletions vs HEAD", () => {
	const dir = initRepo();
	try {
		writeFileSync(join(dir, "f.ts"), "a\nb\nc\n");
		git(dir, "add", "f.ts");
		git(dir, "commit", "-q", "-m", "base");
		// staged: add two lines; unstaged: rewrite further. Both count vs HEAD.
		writeFileSync(join(dir, "f.ts"), "a\nb\nc\nd\ne\n");
		git(dir, "add", "f.ts");
		writeFileSync(join(dir, "f.ts"), "a\nX\nc\nd\ne\nf\n");
		const g = readGit(dir);
		// vs HEAD (a/b/c): +X +d +e +f and -b ⇒ 4 insertions, 1 deletion.
		expect(g?.insertions).toBe(4);
		expect(g?.deletions).toBe(1);
		expect(g?.changedFiles).toBe(1); // one file (f.ts) changed vs HEAD
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: clean tree reports zero line diffstat and a resolved root", () => {
	const dir = initRepo();
	try {
		const g = readGit(dir);
		expect(g?.insertions).toBe(0);
		expect(g?.deletions).toBe(0);
		expect(g?.changedFiles).toBe(0);
		expect(typeof g?.root).toBe("string");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: behindDefault counts commits the feature branch trails the default by", () => {
	const dir = initRepo();
	try {
		git(dir, "checkout", "-q", "-b", "feature");
		git(dir, "checkout", "-q", "main");
		git(dir, "commit", "-q", "--allow-empty", "-m", "ahead-1");
		git(dir, "commit", "-q", "--allow-empty", "-m", "ahead-2");
		git(dir, "checkout", "-q", "feature");
		const g = readGit(dir);
		expect(g?.branch).toBe("feature");
		expect(g?.defaultBranch).toBe("main");
		expect(g?.behindDefault).toBe(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: uninitialized submodule surfaces via git submodule status", () => {
	const dir = initRepo();
	const subSrc = mkdtempSync(join(tmpdir(), "ccsk-git-subsrc-"));
	try {
		git(subSrc, "init", "-q", "-b", "main");
		git(subSrc, "config", "user.email", "t@t.t");
		git(subSrc, "config", "user.name", "t");
		writeFileSync(join(subSrc, "x.ts"), "x");
		git(subSrc, "add", "x.ts");
		git(subSrc, "commit", "-q", "-m", "sub first");
		git(dir, "-c", "protocol.file.allow=always", "submodule", "add", subSrc, "sub");
		git(dir, "commit", "-q", "-m", "add submodule");
		git(dir, "submodule", "deinit", "-f", "sub");
		const g = readGit(dir);
		expect(g?.uninitializedSubmodule).toBe("sub");
	} finally {
		rmSync(subSrc, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});

test("real repo: aggregates submodule changes into counts and lists the submodule branch", () => {
	const dir = initRepo();
	const subSrc = mkdtempSync(join(tmpdir(), "ccsk-git-subsrc-"));
	try {
		git(subSrc, "init", "-q", "-b", "main");
		git(subSrc, "config", "user.email", "t@t.t");
		git(subSrc, "config", "user.name", "t");
		writeFileSync(join(subSrc, "x.ts"), "a\nb\nc\n");
		git(subSrc, "add", "x.ts");
		git(subSrc, "commit", "-q", "-m", "sub first");
		git(dir, "-c", "protocol.file.allow=always", "submodule", "add", subSrc, "sub");
		git(dir, "commit", "-q", "-m", "add submodule");
		const sub = join(dir, "sub");
		// put the submodule on a named branch so its ref is deterministic
		git(sub, "checkout", "-q", "-B", "subbranch");
		// staged: append a line; unstaged: rewrite a line; plus an untracked file
		writeFileSync(join(sub, "x.ts"), "a\nb\nc\nd\n");
		git(sub, "add", "x.ts");
		writeFileSync(join(sub, "x.ts"), "a\nX\nc\nd\n");
		writeFileSync(join(sub, "new.ts"), "u");

		const g = readGit(dir);
		// submodule numstat vs HEAD (a/b/c → a/X/c/d): +X +d -b ⇒ 2 insertions, 1 deletion, 1 file
		expect(g?.insertions).toBeGreaterThanOrEqual(2);
		expect(g?.deletions).toBeGreaterThanOrEqual(1);
		expect(g?.changedFiles).toBeGreaterThanOrEqual(1);
		expect(g?.staged).toBeGreaterThanOrEqual(1);
		expect(g?.unstaged).toBeGreaterThanOrEqual(1);
		expect(g?.untracked).toContain("sub/new.ts");
		expect(g?.submoduleBranches).toContainEqual({ path: "sub", ref: "subbranch" });
	} finally {
		rmSync(subSrc, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});

test("default runner: a throw inside spawnSync degrades to null, never throws", () => {
	// a NUL byte in cwd makes spawnSync throw synchronously; the runner must swallow it.
	expect(() => readGit("/x\0y")).not.toThrow();
	expect(readGit("/x\0y")).toBeNull();
});

test("latency: consolidated read on a real repo stays well under budget", () => {
	const dir = initRepo();
	try {
		const samples: number[] = [];
		for (let i = 0; i < 15; i++) {
			const t0 = performance.now();
			readGit(dir);
			samples.push(performance.now() - t0);
		}
		samples.sort((a, b) => a - b);
		const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1] ?? 0;
		expect(p95).toBeLessThan(500); // generous CI-safe bound; target is ~50ms on a large repo
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
