import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** A git subprocess runner: takes the bare subcommand args, returns stdout (empty string on any failure). */
export type Runner = (args: string[]) => string;

type GitOp = "rebase" | "merge" | "cherry_pick" | "revert" | "none";

/** Full git state, read fresh every render (no TTL, no disk cache). */
export interface GitState {
	/** Current branch; undefined when detached. */
	readonly branch?: string;
	/** Detached-HEAD oid (only set when detached). */
	readonly sha?: string;
	/** Exact tag at HEAD, if any. */
	readonly tag?: string;
	/** Linked-worktree name, derived from the resolved git dir. */
	readonly worktree?: string;
	/** Commits ahead of upstream; undefined when there is no upstream. */
	readonly ahead?: number;
	/** Commits behind upstream; undefined when there is no upstream. */
	readonly behind?: number;
	/** Staged-bucket count (conflicts excluded). */
	readonly staged: number;
	/** Unstaged-bucket count (conflicts excluded). */
	readonly unstaged: number;
	/** Untracked path list (its length is the untracked count). */
	readonly untracked: readonly string[];
	/** Unmerged/conflict count (own bucket, excluded from staged/unstaged). */
	readonly conflict: number;
	/** In-progress operation, located via the resolved git dir. */
	readonly operation: GitOp;
	/** Stash entry count. */
	readonly stash: number;
	/**
	 * Per checked-out submodule (recursively): its path and current branch (or short sha when detached, the
	 * common case). Empty when there are no submodules or none are checked out. Drives the `git_branch` render
	 * (`main · libs/foo@a1b2c3d`); identity stays superproject-only, but branch is shown per submodule.
	 */
	readonly submoduleBranches: readonly { readonly path: string; readonly ref: string }[];
	/** Whether an upstream is configured at all. */
	readonly upstream: boolean;
	/** Upstream configured but gone (deleted on the remote). */
	readonly upstreamGone: boolean;
	/**
	 * A remote-tracking ref `origin/<branch>` exists locally — the branch is already on the remote (pushed
	 * without `-u`) even though no upstream is configured. Only computed when there is a branch and no
	 * upstream (a local ref check, never network); false otherwise.
	 */
	readonly remoteBranchExists: boolean;
	/** Normalized `owner/repo` from `origin`; absent when there is no parseable remote. */
	readonly originRepo?: string;
	/** Resolved default branch; undefined when none can be verified. */
	readonly defaultBranch?: string;
	/** Working-tree root (`--show-toplevel`); absent when it cannot be resolved. */
	readonly root?: string;
	/** The primary checkout's root; differs from `root` only inside a linked worktree, where it is the main repo. */
	readonly mainRoot?: string;
	/** Inserted lines across tracked changes vs HEAD (staged + unstaged). */
	readonly insertions: number;
	/** Deleted lines across tracked changes vs HEAD (staged + unstaged). */
	readonly deletions: number;
	/** Count of files changed vs HEAD (numstat rows), for the `+a -d N files` render. */
	readonly changedFiles: number;
	/**
	 * Commits the current branch trails the default branch by (prefers `origin/<default>`, else the local
	 * default); undefined on the default branch itself or when no default/count can be resolved.
	 */
	readonly behindDefault?: number;
	/** Path of the first uninitialized submodule (a `git submodule status` line beginning `-`); undefined when none. */
	readonly uninitializedSubmodule?: string;
}

/** Conditional-spread an optional key so the literal stays exactOptionalPropertyTypes-safe. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
	value !== undefined ? ({ [key]: value } as Record<K, V>) : {};

// Git repo-location env vars. A parent process or a git hook can export these, which would force every `git`
// invocation onto that repo instead of the one at `cwd`; strip them so reads always target `cwd`. The user's
// config vars (GIT_CONFIG_*) are left intact so reads honor the user's global/system git config.
const GIT_LOCATION_VARS = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_COMMON_DIR",
	"GIT_NAMESPACE",
	"GIT_PREFIX",
	"GIT_CEILING_DIRECTORIES",
] as const;

/** Default runner: `git --no-optional-locks <args>` at `cwd` (location env stripped); nonzero / error / throw ⇒ "". */
function defaultRunner(cwd: string): Runner {
	const env: NodeJS.ProcessEnv = Object.fromEntries(
		Object.entries(process.env).filter(
			([k]) => !(GIT_LOCATION_VARS as readonly string[]).includes(k),
		),
	);
	return (args) => {
		try {
			const r = spawnSync("git", ["--no-optional-locks", ...args], {
				cwd,
				env,
				encoding: "utf8",
				timeout: 1500,
				killSignal: "SIGKILL",
				maxBuffer: 64 * 1024 * 1024,
			});
			if (r.error || r.status !== 0) return "";
			return r.stdout;
		} catch {
			return "";
		}
	};
}

interface ParsedStatus {
	branch?: string;
	sha?: string;
	upstream: boolean;
	upstreamGone: boolean;
	ahead?: number;
	behind?: number;
	stash: number;
	staged: number;
	unstaged: number;
	conflict: number;
	untracked: string[];
}

function isConflict(xy: string): boolean {
	const x = xy[0];
	const y = xy[1];
	return x === "U" || y === "U" || xy === "AA" || xy === "DD";
}

interface StatusAcc {
	branch?: string;
	oid?: string;
	detached: boolean;
	upstream: boolean;
	abPresent: boolean;
	ahead?: number;
	behind?: number;
	stash: number;
	staged: number;
	unstaged: number;
	conflict: number;
	untracked: string[];
}

/** Apply a porcelain-v2 header line (`# branch.oid`, `# branch.head`, …) to the accumulator. */
function parseStatusHeader(line: string, acc: StatusAcc): void {
	if (line.startsWith("# branch.oid ")) {
		acc.oid = line.slice("# branch.oid ".length).trim();
		return;
	}
	if (line.startsWith("# branch.head ")) {
		const v = line.slice("# branch.head ".length).trim();
		if (v === "(detached)") acc.detached = true;
		else acc.branch = v;
		return;
	}
	if (line.startsWith("# branch.upstream ")) {
		acc.upstream = true;
		return;
	}
	if (line.startsWith("# branch.ab ")) {
		const m = /\+(\d+)\s+-(\d+)/.exec(line);
		if (m) {
			acc.ahead = Number(m[1]);
			acc.behind = Number(m[2]);
			acc.abPresent = true;
		}
		return;
	}
	if (line.startsWith("# stash ")) {
		const n = Number(line.slice("# stash ".length).trim());
		acc.stash = Number.isFinite(n) ? n : 0;
	}
}

/** Apply a porcelain-v2 entry line (`?` untracked, `!` ignored, `1`/`2`/`u` tracked) to the accumulator. */
function parseStatusEntry(line: string, acc: StatusAcc): void {
	const type = line[0];
	if (type === "?") {
		acc.untracked.push(line.slice(2));
		return;
	}
	if (type === "!") return;
	if (type === "1" || type === "2" || type === "u") {
		const xy = line.slice(2, 4);
		if (isConflict(xy)) {
			acc.conflict += 1;
			return;
		}
		// `u` entries are always conflicts (handled above); only `1`/`2` reach the buckets.
		if (xy[0] !== "." && xy[0] !== undefined) acc.staged += 1;
		if (xy[1] !== "." && xy[1] !== undefined) acc.unstaged += 1;
	}
}

function parseStatus(out: string): ParsedStatus {
	const acc: StatusAcc = {
		detached: false,
		upstream: false,
		abPresent: false,
		stash: 0,
		staged: 0,
		unstaged: 0,
		conflict: 0,
		untracked: [],
	};

	for (const line of out.split("\n")) {
		if (line === "") continue;
		if (line.startsWith("#")) parseStatusHeader(line, acc);
		else parseStatusEntry(line, acc);
	}

	return {
		...opt("branch", acc.branch),
		...opt("sha", acc.detached ? acc.oid : undefined),
		upstream: acc.upstream,
		upstreamGone: acc.upstream && !acc.abPresent,
		...opt("ahead", acc.ahead),
		...opt("behind", acc.behind),
		stash: acc.stash,
		staged: acc.staged,
		unstaged: acc.unstaged,
		conflict: acc.conflict,
		untracked: acc.untracked,
	};
}

/**
 * Sum inserted/deleted lines and count changed files from `git diff HEAD --numstat`. Every non-empty row is a
 * changed file (binary rows carry `-\t-`: counted as a file, contributing no line counts).
 */
function parseNumstat(out: string): { insertions: number; deletions: number; files: number } {
	let insertions = 0;
	let deletions = 0;
	let files = 0;
	for (const line of out.split("\n")) {
		if (line === "") continue;
		files += 1;
		const [addRaw, delRaw] = line.split("\t");
		const add = Number(addRaw);
		const del = Number(delRaw);
		if (Number.isFinite(add)) insertions += add;
		if (Number.isFinite(del)) deletions += del;
	}
	return { insertions, deletions, files };
}

function readOperation(gitDir: string): GitOp {
	if (gitDir === "") return "none";
	if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply")))
		return "rebase";
	if (existsSync(join(gitDir, "MERGE_HEAD"))) return "merge";
	if (existsSync(join(gitDir, "CHERRY_PICK_HEAD"))) return "cherry_pick";
	if (existsSync(join(gitDir, "REVERT_HEAD"))) return "revert";
	return "none";
}

function worktreeName(gitDir: string): string | undefined {
	const m = /\/worktrees\/([^/]+)\/?$/.exec(gitDir);
	return m?.[1];
}

/**
 * The primary checkout's root. Inside a linked worktree the git dir is `<mainRoot>/.git/worktrees/<name>`, so
 * strip that suffix to recover the main repo; outside a worktree it is just the work-tree root.
 */
function mainWorkTreeRoot(gitDir: string, workTreeRoot: string): string {
	const m = /^(.*)\/\.git\/worktrees\/[^/]+\/?$/.exec(gitDir);
	return m?.[1] ?? workTreeRoot;
}

/** Count `.gitmodules` stanzas at the working-tree root (`--show-toplevel`), which is correct in linked worktrees. */
function countSubmodules(workTreeRoot: string): number {
	if (workTreeRoot === "") return 0;
	try {
		const content = readFileSync(join(workTreeRoot, ".gitmodules"), "utf8");
		return (content.match(/^\[submodule /gm) ?? []).length;
	} catch {
		return 0;
	}
}

/** Strip the transport/host prefix and trailing `.git`; undefined for local/file remotes with no owner/repo shape. */
export function normalizeOriginRepo(url: string): string | undefined {
	const trimmed = url.trim();
	if (trimmed === "") return undefined;
	const stripped = trimmed
		.replace(/^(?:git@[^:]+:|ssh:\/\/[^/]+\/|https?:\/\/[^/]+\/)/, "")
		.replace(/\.git\/?$/, "");
	if (
		stripped.includes("://") ||
		stripped.startsWith("/") ||
		stripped.startsWith(".") ||
		stripped.includes("\\")
	) {
		return undefined;
	}
	if (!/^[^/\s]+(?:\/[^/\s]+)+$/.test(stripped)) return undefined;
	return stripped;
}

function resolveDefaultBranch(run: Runner): string | undefined {
	const symref = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim();
	if (symref !== "") return symref.replace(/^origin\//, "");
	if (run(["rev-parse", "--verify", "--quiet", "refs/heads/main"]).trim() !== "") return "main";
	if (run(["rev-parse", "--verify", "--quiet", "refs/heads/master"]).trim() !== "")
		return "master";
	return undefined;
}

/**
 * Commits the current branch is behind the default branch (`HEAD..<default>`), preferring `origin/<default>`
 * when that remote ref exists, else the local default. Undefined when there is no default, the current branch
 * is the default, or the count cannot be read. Never throws (the runner swallows failures).
 */
function readBehindDefault(
	run: Runner,
	branch: string | undefined,
	defaultBranch: string | undefined,
): number | undefined {
	if (defaultBranch === undefined) return undefined;
	if (branch !== undefined && branch === defaultBranch) return undefined;
	const ref =
		(
			run([
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/remotes/origin/${defaultBranch}`,
			]).trim() !== ""
		) ?
			`origin/${defaultBranch}`
		:	defaultBranch;
	const out = run(["rev-list", "--count", `HEAD..${ref}`]).trim();
	if (out === "") return undefined;
	const n = Number(out);
	return Number.isFinite(n) ? n : undefined;
}

interface SubmoduleRollup {
	insertions: number;
	deletions: number;
	changedFiles: number;
	staged: number;
	unstaged: number;
	conflict: number;
	stash: number;
	untracked: string[];
	branches: { path: string; ref: string }[];
	/** Path of the first uninitialized (`-`-prefixed) submodule seen in the rollup pass; undefined when none. */
	uninitialized?: string;
}

/**
 * Fold one checked-out submodule's count/state buckets, line diffstat, path-prefixed untracked entries, and
 * current branch (or short sha when detached) into the rollup. Queried through the same runner with a
 * `-C <abs-path>` prefix; the runner swallows failures so a malformed status degrades to empty buckets.
 */
function accumulateSubmodule(
	rollup: SubmoduleRollup,
	run: Runner,
	workTreeRoot: string,
	subPath: string,
): void {
	const sub = (args: string[]): string => run(["-C", resolve(workTreeRoot, subPath), ...args]);

	const status = parseStatus(sub(["status", "--porcelain=v2", "--branch", "--show-stash"]));
	rollup.staged += status.staged;
	rollup.unstaged += status.unstaged;
	rollup.conflict += status.conflict;
	rollup.stash += status.stash;
	for (const entry of status.untracked) rollup.untracked.push(`${subPath}/${entry}`);

	const { insertions, deletions, files } = parseNumstat(sub(["diff", "HEAD", "--numstat"]));
	rollup.insertions += insertions;
	rollup.deletions += deletions;
	rollup.changedFiles += files;

	const ref = status.branch ?? (status.sha !== undefined ? status.sha.slice(0, 7) : undefined);
	if (ref !== undefined && ref !== "") rollup.branches.push({ path: subPath, ref });
}

/**
 * Sum the count/state buckets of every checked-out submodule (recursively) and capture each one's branch, plus
 * the first uninitialized submodule's path. Only consulted when `.gitmodules` declares submodules, so a
 * submodule-free repo runs zero extra subprocesses. Never throws — the runner swallows failures and a malformed
 * status line is skipped (guarded indexing).
 */
function readSubmoduleRollup(run: Runner, workTreeRoot: string): SubmoduleRollup {
	const rollup: SubmoduleRollup = {
		insertions: 0,
		deletions: 0,
		changedFiles: 0,
		staged: 0,
		unstaged: 0,
		conflict: 0,
		stash: 0,
		untracked: [],
		branches: [],
	};
	for (const line of run(["submodule", "status", "--recursive"]).split("\n")) {
		if (line === "") continue;
		// `<flag><sha> <path> (<describe>)`; strip the leading flag char, the path is the 2nd token.
		const parts = line.slice(1).trim().split(/\s+/);
		if (line.startsWith("-")) {
			// A leading `-` marks an uninitialized submodule (not checked out): it cannot be queried, so
			// capture the first one's path (for the `submodule_uninitialized` hint) and skip it.
			const path = parts[1] ?? parts[0];
			if (rollup.uninitialized === undefined && path !== undefined && path !== "") {
				rollup.uninitialized = path;
			}
			continue;
		}
		const subPath = parts[1];
		if (subPath !== undefined && subPath !== "") {
			accumulateSubmodule(rollup, run, workTreeRoot, subPath);
		}
	}
	return rollup;
}

/** Read the git state for `cwd` via the injected runner, or `null` when it is not inside a work tree. */
export function readGit(cwd: string, run: Runner = defaultRunner(cwd)): GitState | null {
	// One rev-parse invocation answers all three location probes (in flag order), collapsing three fork+execs
	// into one. Outside a work tree the command fails wholesale (empty output), so line 0 is not "true".
	const probe = run(["rev-parse", "--is-inside-work-tree", "--git-dir", "--show-toplevel"]).split(
		"\n",
	);
	if ((probe[0] ?? "").trim() !== "true") return null;

	const status = parseStatus(run(["status", "--porcelain=v2", "--branch", "--show-stash"]));

	const gitDirRaw = (probe[1] ?? "").trim();
	const gitDir = gitDirRaw === "" ? "" : resolve(cwd, gitDirRaw);
	const workTreeRoot = (probe[2] ?? "").trim();

	const tag = run(["describe", "--tags", "--exact-match"]).trim() || undefined;
	const originRepo = normalizeOriginRepo(run(["remote", "get-url", "origin"]));
	const defaultBranch = resolveDefaultBranch(run);

	const {
		insertions,
		deletions,
		files: changedFiles,
	} = parseNumstat(run(["diff", "HEAD", "--numstat"]));

	// Gate all submodule rollup work on `.gitmodules` declaring submodules: a plain repo pays zero extra cost.
	const rollup =
		countSubmodules(workTreeRoot) > 0 ? readSubmoduleRollup(run, workTreeRoot) : null;
	const behindDefault = readBehindDefault(run, status.branch, defaultBranch);

	// The `no_upstream` hint is noise once the branch is already on the remote (pushed without `-u`): only
	// check when there is a branch and no configured upstream, against the local remote-tracking ref (no network).
	const remoteBranchExists =
		status.branch !== undefined && !status.upstream ?
			run([
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/remotes/origin/${status.branch}`,
			]).trim() !== ""
		:	false;

	return {
		...opt("branch", status.branch),
		...opt("sha", status.sha),
		...opt("tag", tag),
		...opt("worktree", worktreeName(gitDir)),
		...opt("ahead", status.ahead),
		...opt("behind", status.behind),
		staged: status.staged + (rollup?.staged ?? 0),
		unstaged: status.unstaged + (rollup?.unstaged ?? 0),
		untracked: rollup !== null ? [...status.untracked, ...rollup.untracked] : status.untracked,
		conflict: status.conflict + (rollup?.conflict ?? 0),
		operation: readOperation(gitDir),
		stash: status.stash + (rollup?.stash ?? 0),
		submoduleBranches: rollup?.branches ?? [],
		upstream: status.upstream,
		upstreamGone: status.upstreamGone,
		remoteBranchExists,
		...opt("originRepo", originRepo),
		...opt("defaultBranch", defaultBranch),
		...opt("root", workTreeRoot === "" ? undefined : workTreeRoot),
		...opt(
			"mainRoot",
			workTreeRoot === "" ? undefined : mainWorkTreeRoot(gitDir, workTreeRoot),
		),
		insertions: insertions + (rollup?.insertions ?? 0),
		deletions: deletions + (rollup?.deletions ?? 0),
		changedFiles: changedFiles + (rollup?.changedFiles ?? 0),
		...opt("behindDefault", behindDefault),
		...opt("uninitializedSubmodule", rollup?.uninitialized),
	};
}
