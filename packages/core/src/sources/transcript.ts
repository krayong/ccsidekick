import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { BURN_WINDOW_MS, COST_TTL_MS, asProject, asSession } from "../domain";

import type { Clock } from "./clock";
import type {
	AnalyticsRecord,
	CostAggregate,
	CostCache,
	CostFileEntry,
	CostLine,
} from "./costCache";

// --- Public contracts --------------------------------------------------------

/** Normalized `message.usage`. The injected pricer reads these fields; `usage.iterations[]` is ignored. */
export interface Usage {
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_input_tokens: number;
	readonly cache_creation_input_tokens: number;
	readonly cache_creation?: {
		readonly ephemeral_5m_input_tokens: number;
		readonly ephemeral_1h_input_tokens: number;
	};
	readonly speed?: string;
}

/**
 * Pure pricer injected from `derived/pricing`; an unknown model prices to 0 and never throws. `atMs` is the
 * message timestamp, used to price date-dependent models at the rate in effect when the message was sent.
 */
export type PriceFn = (usage: Usage, modelId: string, atMs?: number) => number;

/** A session→project resolver: `attribution[session].project` when recorded, else the decoded-cwd path. */
export type ResolveProject = (session: string, decodedCwd: string) => string;

export interface BurnBucket {
	readonly ts: number;
	readonly tokens: number;
	readonly costUsd: number;
}

interface TodoItem {
	readonly content: string;
	readonly status: string;
}

/** Per-class token sums; `cache_creation` is split 5-minute / 1-hour. */
export interface TokenSums {
	readonly input: number;
	readonly output: number;
	readonly cache_read: number;
	readonly cache_creation_5m: number;
	readonly cache_creation_1h: number;
}

/** The current-session scan. `mtime`/`size` gate the next tick (return this unchanged when they match). */
export interface TranscriptScan {
	readonly tokens: TokenSums;
	readonly messages: number;
	readonly compactions: number;
	readonly todos: readonly TodoItem[];
	/** First-seen timestamp of the current in-progress todo (for `todo_stalled`). */
	readonly inProgressSinceMs?: number;
	/** Latest `message.usage.speed`. */
	readonly speed?: string;
	readonly burn: readonly BurnBucket[];
	readonly mtime: number;
	readonly size: number;
}

// The cost-file/analytics/aggregate/cache types are owned by `sources/costCache` (the on-disk store);
// re-exported here for the cost-path consumers that import from this module.
export type {
	AnalyticsRecord,
	CostAggregate,
	CostCache,
	CostFileEntry,
	CostLine,
} from "./costCache";

// --- Loose-JSON helpers (sources/** confines the unsafe access) ---------------

const asObj = (v: unknown): Record<string, unknown> | undefined =>
	v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const asArr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

interface ToolUse {
	readonly name: string;
	readonly input: Record<string, unknown>;
}

interface ParsedLine {
	type: string | undefined;
	subtype: string | undefined;
	id: string | undefined;
	requestId: string | undefined;
	isSidechain: boolean;
	sessionId: string | undefined;
	model: string | undefined;
	usage: Usage | undefined;
	tsMs: number | undefined;
	toolUses: readonly ToolUse[];
}

type CountedLine = ParsedLine & { usage: Usage };

function parseTs(s: string | undefined): number | undefined {
	if (s === undefined) return undefined;
	const t = Date.parse(s);
	return Number.isFinite(t) ? t : undefined;
}

function parseUsage(u: Record<string, unknown>): Usage {
	const cc = asObj(u["cache_creation"]);
	const speed = asStr(u["speed"]);
	return {
		input_tokens: asNum(u["input_tokens"]),
		output_tokens: asNum(u["output_tokens"]),
		cache_read_input_tokens: asNum(u["cache_read_input_tokens"]),
		cache_creation_input_tokens: asNum(u["cache_creation_input_tokens"]),
		...(cc ?
			{
				cache_creation: {
					ephemeral_5m_input_tokens: asNum(cc["ephemeral_5m_input_tokens"]),
					ephemeral_1h_input_tokens: asNum(cc["ephemeral_1h_input_tokens"]),
				},
			}
		:	{}),
		...(speed !== undefined ? { speed } : {}),
	};
}

function extractToolUses(message: Record<string, unknown> | undefined): ToolUse[] {
	if (!message) return [];
	const out: ToolUse[] = [];
	for (const c of asArr(message["content"])) {
		const o = asObj(c);
		if (!o || o["type"] !== "tool_use") continue;
		const name = asStr(o["name"]);
		if (name === undefined) continue;
		out.push({ name, input: asObj(o["input"]) ?? {} });
	}
	return out;
}

function parseLine(raw: string): ParsedLine | null {
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return null;
	}
	const o = asObj(v);
	if (!o) return null;
	const message = asObj(o["message"]);
	const usageObj = message ? asObj(message["usage"]) : undefined;
	return {
		type: asStr(o["type"]),
		subtype: asStr(o["subtype"]),
		id: message ? asStr(message["id"]) : undefined,
		requestId: asStr(o["requestId"]),
		isSidechain: o["isSidechain"] === true,
		sessionId: asStr(o["sessionId"]),
		model: message ? asStr(message["model"]) : undefined,
		usage: usageObj ? parseUsage(usageObj) : undefined,
		tsMs: parseTs(asStr(o["timestamp"])),
		toolUses: extractToolUses(message),
	};
}

function parseAll(text: string): ParsedLine[] {
	const out: ParsedLine[] = [];
	for (const raw of text.split("\n")) {
		if (raw.trim() === "") continue;
		const l = parseLine(raw);
		if (l) out.push(l);
	}
	return out;
}

function tokenize(u: Usage): {
	input: number;
	output: number;
	cache_read: number;
	c5m: number;
	c1h: number;
} {
	const c5m =
		u.cache_creation ?
			u.cache_creation.ephemeral_5m_input_tokens
		:	u.cache_creation_input_tokens;
	const c1h = u.cache_creation ? u.cache_creation.ephemeral_1h_input_tokens : 0;
	return {
		input: u.input_tokens,
		output: u.output_tokens,
		cache_read: u.cache_read_input_tokens,
		c5m,
		c1h,
	};
}

/**
 * Usage-line dedup, as a stateful first-seen gate so the per-file and global passes share one rule. `gate(...)`
 * returns true the first time a counted line should be counted: key each line by `${id}|${requestId}`; fold a
 * `message.id`-only match when either the new or an already-counted line is a sidechain; a line with no
 * `message.id` is always counted.
 */
function makeDedupGate(): (
	id: string | undefined,
	reqId: string | undefined,
	sidechain: boolean,
) => boolean {
	const seenKeys = new Set<string>();
	const countedIds = new Set<string>();
	const countedSidechainIds = new Set<string>();
	return (id, reqId, sidechain) => {
		if (id === undefined) return true;
		if (countedIds.has(id) && (sidechain || countedSidechainIds.has(id))) return false;
		const key = `${id}|${reqId ?? ""}`;
		if (seenKeys.has(key)) return false;
		seenKeys.add(key);
		countedIds.add(id);
		if (sidechain) countedSidechainIds.add(id);
		return true;
	};
}

function dedupCounted(lines: readonly ParsedLine[]): CountedLine[] {
	const gate = makeDedupGate();
	const out: CountedLine[] = [];
	for (const l of lines) {
		const usage = l.usage;
		if (usage === undefined) continue;
		if (gate(l.id, l.requestId, l.isSidechain)) out.push({ ...l, usage });
	}
	return out;
}

/**
 * Collapse the streaming writes of one message to its final one. As an assistant message streams, Claude Code
 * re-logs it under the same `(message.id, requestId)` with monotonically growing `output_tokens` (its other
 * token classes are constant — the input context doesn't change mid-message). Keeping the first write
 * under-counts output, so for each `(id, requestId)` keep the write with the greatest `output_tokens`, emitted
 * once at its first position. Non-usage lines and lines missing `id`/`requestId` pass through unchanged.
 */
function collapseStreaming(lines: readonly ParsedLine[]): ParsedLine[] {
	const keyed = (l: ParsedLine): string | null =>
		l.usage !== undefined && l.id !== undefined && l.requestId !== undefined ?
			`${l.id}|${l.requestId}`
		:	null;

	const best = new Map<string, ParsedLine>();
	for (const l of lines) {
		const key = keyed(l);
		if (key === null) continue;
		const prev = best.get(key);
		if (
			prev === undefined ||
			(l.usage?.output_tokens ?? 0) > (prev.usage?.output_tokens ?? 0)
		) {
			best.set(key, l);
		}
	}

	const emitted = new Set<string>();
	const out: ParsedLine[] = [];
	for (const l of lines) {
		const key = keyed(l);
		if (key === null) {
			out.push(l);
			continue;
		}
		if (emitted.has(key)) continue;
		emitted.add(key);
		out.push(best.get(key) ?? l);
	}
	return out;
}

// --- Todo reconstruction -----------------------------------------------------

function parseTodos(v: unknown): TodoItem[] {
	const out: TodoItem[] = [];
	for (const item of asArr(v)) {
		const o = asObj(item);
		if (!o) continue;
		const content = asStr(o["content"]) ?? asStr(o["activeForm"]);
		if (content === undefined) continue;
		out.push({ content, status: asStr(o["status"]) ?? asStr(o["state"]) ?? "pending" });
	}
	return out;
}

interface TodoState {
	readonly todos: readonly TodoItem[];
	readonly inProgressSinceMs: number | undefined;
}

/** Parse one `TodoWrite` snapshot, latching the first-seen timestamp of each in-progress item. */
function applyTodoWrite(
	tu: ToolUse,
	tsMs: number | undefined,
	firstInProgress: Map<string, number>,
): TodoItem[] {
	const todos = parseTodos(tu.input["todos"]);
	if (tsMs !== undefined) {
		for (const td of todos) {
			if (td.status === "in_progress" && !firstInProgress.has(td.content)) {
				firstInProgress.set(td.content, tsMs);
			}
		}
	}
	return todos;
}

/** Legacy `TodoWrite`: last-write-wins whole-list snapshots. */
function reconstructFromTodoWrite(lines: readonly ParsedLine[]): TodoState {
	let final: TodoItem[] = [];
	const firstInProgress = new Map<string, number>();
	for (const l of lines) {
		for (const tu of l.toolUses) {
			if (tu.name === "TodoWrite") final = applyTodoWrite(tu, l.tsMs, firstInProgress);
		}
	}
	const inProgress = final.find((t) => t.status === "in_progress");
	return {
		todos: final,
		inProgressSinceMs: inProgress ? firstInProgress.get(inProgress.content) : undefined,
	};
}

/**
 * Current `TaskCreate`/`TaskUpdate` tools: incremental create/update by task id. Their JSON shape is not
 * documented; field names (`task_id`/`id`, `content`/`activeForm`, `status`) are read defensively.
 */
function reconstructFromTasks(lines: readonly ParsedLine[]): TodoState {
	const tasks = new Map<string, { content: string; status: string }>();
	const firstInProgress = new Map<string, number>();
	const touch = (id: string, content: string, status: string, tsMs: number | undefined): void => {
		tasks.set(id, { content, status });
		if (status === "in_progress" && tsMs !== undefined && !firstInProgress.has(id)) {
			firstInProgress.set(id, tsMs);
		}
	};
	for (const l of lines) {
		for (const tu of l.toolUses) {
			const id = asStr(tu.input["task_id"]) ?? asStr(tu.input["id"]);
			if (tu.name === "TaskCreate") {
				const key = id ?? String(tasks.size);
				const content =
					asStr(tu.input["content"]) ??
					asStr(tu.input["activeForm"]) ??
					asStr(tu.input["description"]) ??
					"";
				touch(
					key,
					content,
					asStr(tu.input["status"]) ?? asStr(tu.input["state"]) ?? "pending",
					l.tsMs,
				);
			} else if (tu.name === "TaskUpdate" && id !== undefined) {
				const prev = tasks.get(id) ?? { content: "", status: "pending" };
				const content = asStr(tu.input["content"]) ?? prev.content;
				const status = asStr(tu.input["status"]) ?? asStr(tu.input["state"]) ?? prev.status;
				touch(id, content, status, l.tsMs);
			}
		}
	}
	const entries = [...tasks.entries()];
	const inProgress = entries.find(([, t]) => t.status === "in_progress");
	return {
		todos: entries.map(([, t]) => ({ content: t.content, status: t.status })),
		inProgressSinceMs: inProgress ? firstInProgress.get(inProgress[0]) : undefined,
	};
}

function reconstructTodos(lines: readonly ParsedLine[]): TodoState {
	const hasTask = lines.some((l) =>
		l.toolUses.some((t) => t.name === "TaskCreate" || t.name === "TaskUpdate"),
	);
	return hasTask ? reconstructFromTasks(lines) : reconstructFromTodoWrite(lines);
}

// --- Filesystem helpers ------------------------------------------------------

function statSafe(p: string): { mtimeMs: number; size: number } | null {
	try {
		const s = statSync(p);
		return { mtimeMs: s.mtimeMs, size: s.size };
	} catch {
		return null;
	}
}

function readSafe(p: string): string {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return "";
	}
}

function readBufSafe(p: string): Buffer | null {
	try {
		return readFileSync(p);
	} catch {
		return null;
	}
}

/** Read bytes `[start, end)`; null on any error or short read. Used for the incremental tail + head-hash probes. */
function readRange(p: string, start: number, end: number): Buffer | null {
	if (end <= start) return Buffer.alloc(0);
	let fd: number | undefined;
	try {
		fd = openSync(p, "r");
		const len = end - start;
		const buf = Buffer.allocUnsafe(len);
		let off = 0;
		while (off < len) {
			const n = readSync(fd, buf, off, len - off, start + off);
			if (n === 0) break;
			off += n;
		}
		return off === len ? buf : null;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

// The active transcript grows every tick; re-reading + JSON.parsing the whole file dominates the cost scan. A
// cached entry stores the byte offset of its last complete line and a hash of its head, so the next scan reads
// and prices only the appended tail. The head hash catches a compaction rewrite (prefix changed) ⇒ full reparse.
const HEAD_HASH_BYTES = 4096;

/** FNV-1a over the given head bytes; a mismatch on resume means the prefix was rewritten. */
function headHashOf(head: Buffer): string {
	let h = 0x811c9dc5;
	for (const b of head) {
		h ^= b;
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

/** First-seen model interner backed by `models` (mutated in place); `CostLine.m` indexes into it. */
function makeInternModel(models: string[]): (model: string) => number {
	const index = new Map<string, number>();
	models.forEach((m, i) => index.set(m, i));
	return (model) => {
		let i = index.get(model);
		if (i === undefined) {
			i = models.length;
			models.push(model);
			index.set(model, i);
		}
		return i;
	};
}

/** Byte offset just past the last newline (the end of the last complete line); 0 when the buffer has none. */
function lastLineEnd(buf: Buffer): number {
	const i = buf.lastIndexOf(0x0a);
	return i < 0 ? 0 : i + 1;
}

const headLen = (byteOffset: number): number => Math.min(HEAD_HASH_BYTES, byteOffset);

const EMPTY_TOKENS: TokenSums = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_creation_5m: 0,
	cache_creation_1h: 0,
};

function emptyScan(mtime: number, size: number): TranscriptScan {
	return { tokens: EMPTY_TOKENS, messages: 0, compactions: 0, todos: [], burn: [], mtime, size };
}

// --- scanTranscript (current session) ----------------------------------------

/**
 * Scan the current session's transcript: token sums, message/compaction counts, the current todo list, the
 * latest speed, and the live 5-hour burn buckets. When `prev` matches the file's mtime+size it is returned
 * unchanged, so an untouched multi-MB JSONL is not re-read every tick.
 */
export function scanTranscript(
	transcriptPath: string,
	clock: Clock,
	price: PriceFn,
	prev?: TranscriptScan,
): TranscriptScan {
	const st = statSafe(transcriptPath);
	if (!st) return emptyScan(0, 0);
	if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) return prev;

	const lines = parseAll(readSafe(transcriptPath));
	const windowStart = clock.now() - BURN_WINDOW_MS;

	let compactions = 0;
	for (const l of lines) {
		if (l.type === "system" && l.subtype === "compact_boundary") compactions += 1;
	}

	const counted = dedupCounted(collapseStreaming(lines));
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cc5m = 0;
	let cc1h = 0;
	let speed: string | undefined;
	const burn: BurnBucket[] = [];
	for (const l of counted) {
		const t = tokenize(l.usage);
		input += t.input;
		output += t.output;
		cacheRead += t.cache_read;
		cc5m += t.c5m;
		cc1h += t.c1h;
		if (l.usage.speed !== undefined) speed = l.usage.speed;
		if (l.tsMs !== undefined && l.tsMs >= windowStart) {
			burn.push({
				ts: l.tsMs,
				tokens: t.input + t.output + t.cache_read + t.c5m + t.c1h,
				costUsd: price(l.usage, l.model ?? "", l.tsMs),
			});
		}
	}

	const todoState = reconstructTodos(lines);
	return {
		tokens: {
			input,
			output,
			cache_read: cacheRead,
			cache_creation_5m: cc5m,
			cache_creation_1h: cc1h,
		},
		messages: counted.length,
		compactions,
		todos: todoState.todos,
		...(todoState.inProgressSinceMs !== undefined ?
			{ inProgressSinceMs: todoState.inProgressSinceMs }
		:	{}),
		...(speed !== undefined ? { speed } : {}),
		burn,
		mtime: st.mtimeMs,
		size: st.size,
	};
}

// --- scanCostTree (Project / Total) ------------------------------------------

/** Inverse of the `/`,`.`→`-` cwd encoding (lossy); the resolver overrides this when attribution exists. */
function decodeCwd(encoded: string): string {
	return `/${encoded.replace(/^-/, "").replace(/-/g, "/")}`;
}

/**
 * The cost-side Project key for an absolute cwd: encode it the way Claude Code names the transcript dir
 * (`/`,`.`→`-`) then decode, so the render-side lookup lands on the exact key the scan stores for that dir.
 */
export function projectKeyForCwd(cwd: string): string {
	return decodeCwd(cwd.replace(/[/.]/g, "-"));
}

/**
 * The cost-side Project key for the current session, taken from the directory its transcript is filed under
 * (the encoded-cwd dir Claude Code named at session start) rather than the live cwd. This is the exact key
 * `scanCostTree` stores for every sibling session in that dir, so Project matching survives a mid-session `cd`
 * into a subdirectory — which moves `workspace.current_dir` but never the transcript's directory. Returns
 * `undefined` when no transcript path is known (the first tick, before Claude Code has written one), so the
 * caller can fall back to the live cwd.
 */
export function projectKeyForTranscript(transcriptPath: string): string | undefined {
	if (transcriptPath === "") return undefined;
	return decodeCwd(basename(dirname(transcriptPath)));
}

const repoRootCache = new Map<string, string>();

/**
 * The git repo root a `cwd` belongs to: the nearest ancestor whose `.git` is a DIRECTORY (a real repo root, not a
 * worktree's `.git` FILE), so the stats board groups a repo's subdirectories and its in-repo worktrees under one
 * project instead of one entry per working directory. Returns `cwd` unchanged when no such ancestor exists (e.g. a
 * historical path that no longer exists on disk). Memoized — the analytics scan calls it per unique project key.
 */
export function repoRootForCwd(cwd: string): string {
	const cached = repoRootCache.get(cwd);
	if (cached !== undefined) return cached;
	let dir = cwd;
	let result = cwd;
	while (dir !== "" && dir !== dirname(dir)) {
		try {
			if (statSync(join(dir, ".git")).isDirectory()) {
				result = dir;
				break;
			}
		} catch {
			// no readable .git here; keep walking up
		}
		dir = dirname(dir);
	}
	repoRootCache.set(cwd, result);
	return result;
}

/** Yield every `.jsonl` under `dir` at any depth, tagging each with the top-level `encodedDir` for its project. */
function* walkTree(
	dir: string,
	encodedDir: string,
): Generator<{ path: string; encodedDir: string }> {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		const full = join(dir, name);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			yield* walkTree(full, encodedDir);
		} else if (name.endsWith(".jsonl")) {
			yield { path: full, encodedDir };
		}
	}
}

/**
 * Walk `root/<encoded-cwd>/**​/*.jsonl` — recursing to any depth so a session's Task sub-agent transcripts
 * (under `<session>/subagents/*.jsonl`, sharing the parent's `sessionId`) are priced too; they carry real
 * billable usage and skipping them under-counts cost. Each file keeps the top-level `encodedDir` as its project.
 */
function* walkJsonl(root: string): Generator<{ path: string; encodedDir: string }> {
	let dirs: string[];
	try {
		dirs = readdirSync(root);
	} catch {
		return;
	}
	for (const encodedDir of dirs) {
		yield* walkTree(join(root, encodedDir), encodedDir);
	}
}

/** First session id and the min/max timestamps across a file's lines (start `Infinity`/end `-Infinity` when none). */
function scanBounds(lines: readonly ParsedLine[]): {
	sessionId: string | undefined;
	start: number;
	end: number;
} {
	let sessionId: string | undefined;
	let start = Infinity;
	let end = -Infinity;
	for (const l of lines) {
		if (l.sessionId !== undefined && sessionId === undefined) sessionId = l.sessionId;
		if (l.tsMs !== undefined) {
			if (l.tsMs < start) start = l.tsMs;
			if (l.tsMs > end) end = l.tsMs;
		}
	}
	return { sessionId, start, end };
}

function priceFile(
	path: string,
	encodedDir: string,
	st: { mtimeMs: number; size: number },
	price: PriceFn,
	resolveProject: ResolveProject,
): CostFileEntry {
	// Parse only complete (newline-terminated) lines: a trailing partial line is a write in progress, deferred
	// to the next scan once it completes. `byteOffset`/`headHash` let the next scan tail-parse only the growth.
	const buf = readBufSafe(path) ?? Buffer.alloc(0);
	const byteOffset = lastLineEnd(buf);
	const headHash = headHashOf(buf.subarray(0, headLen(byteOffset)));
	const lines = parseAll(buf.subarray(0, byteOffset).toString("utf8"));
	const { sessionId, start, end } = scanBounds(lines);

	// Collapse each message's streaming writes to its final one before pricing, so a partial early write never
	// stands in for the completed output. One pass, pricing each usage-bearing line exactly once: every priced
	// line goes into `costLines` (for the global dedup at aggregation time); the per-file deduped survivors feed
	// the analytics record + per-file `total`.
	const priced = collapseStreaming(lines);
	const gate = makeDedupGate();
	const costLines: CostLine[] = [];
	const models: string[] = [];
	const internModel = makeInternModel(models);
	let total = 0;
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheCreation = 0;
	let messages = 0;
	for (const l of priced) {
		const usage = l.usage;
		if (usage === undefined) continue;
		const cost = price(usage, l.model ?? "", l.tsMs);
		const t = tokenize(usage);
		costLines.push({
			...(l.id !== undefined ? { id: l.id } : {}),
			...(l.requestId !== undefined ? { reqId: l.requestId } : {}),
			sidechain: l.isSidechain,
			ts: l.tsMs ?? 0,
			cost,
			...(l.model !== undefined ? { m: internModel(l.model) } : {}),
			tok: t.input + t.output + t.cache_read + t.c5m + t.c1h,
		});
		if (gate(l.id, l.requestId, l.isSidechain)) {
			input += t.input;
			output += t.output;
			cacheRead += t.cache_read;
			cacheCreation += t.c5m + t.c1h;
			total += cost;
			messages += 1;
		}
	}

	const session = sessionId ?? basename(path, ".jsonl");
	const projectPath = decodeCwd(encodedDir);
	const project = resolveProject(session, projectPath);
	const record: AnalyticsRecord = {
		session: asSession(session),
		project: asProject(project),
		start: Number.isFinite(start) ? start : 0,
		end: Number.isFinite(end) ? end : 0,
		tokens: { input, output, cache_read: cacheRead, cache_creation: cacheCreation },
		messages,
	};
	return {
		mtime: st.mtimeMs,
		size: st.size,
		byteOffset,
		headHash,
		total,
		lines: costLines,
		models,
		projectPath,
		record,
	};
}

/**
 * Incremental resume: reprice only the bytes appended since `cached.byteOffset`, folding them into the cached
 * entry so the result is byte-identical to a full `priceFile` of the grown file. Returns `null` when a resume
 * is unsound (offset/hash mismatch, truncation, or a partial-only append) so the caller full-reparses.
 *
 * Streaming is handled across the tail boundary: an appended write of a key already in `cached.lines` keeps the
 * higher-output one (its token classes other than output are constant mid-message, so a larger total-token
 * count means a later write). The per-file dedup gate is replayed over the cached lines to know each key's
 * counted status, so a sidechain re-log appended in the tail folds out exactly as in a full parse.
 */
function resumeCostFile(
	cached: CostFileEntry,
	path: string,
	st: { mtimeMs: number; size: number },
	price: PriceFn,
): CostFileEntry | null {
	const tail = readAppendedTail(cached, path, st);
	if (tail === null) return null;
	// Only a partial line was appended (no complete new line yet): content unchanged, refresh the stat only.
	if (tail === "partial") return { ...cached, mtime: st.mtimeMs, size: st.size };

	const models: string[] = [...cached.models];
	const keyIndex = new Map<string, number>();
	cached.lines.forEach((l, i) => {
		if (l.id !== undefined && l.reqId !== undefined) keyIndex.set(`${l.id}|${l.reqId}`, i);
	});
	// Replay the per-file gate over the cached lines: `counted[i]` records whether each line fed the record/total,
	// and the gate is left in the post-cached state to judge appended keys (incl. sidechain folds by message.id).
	const gate = makeDedupGate();
	const acc: TailAcc = {
		lines: [...cached.lines],
		models,
		counted: cached.lines.map((l) => gate(l.id, l.reqId, l.sidechain)),
		keyIndex,
		gate,
		internModel: makeInternModel(models),
		input: cached.record.tokens.input,
		output: cached.record.tokens.output,
		cacheRead: cached.record.tokens.cache_read,
		cacheCreation: cached.record.tokens.cache_creation,
		total: cached.total,
		messages: cached.record.messages,
		start: cached.record.start,
		end: cached.record.end,
	};

	for (const l of collapseStreaming(tail.appended)) foldAppendedLine(acc, l, price);

	return {
		mtime: st.mtimeMs,
		size: st.size,
		byteOffset: tail.newByteOffset,
		headHash: tail.newHeadHash,
		total: acc.total,
		lines: acc.lines,
		models: acc.models,
		projectPath: cached.projectPath,
		record: {
			...cached.record,
			start: acc.start,
			end: acc.end,
			tokens: {
				input: acc.input,
				output: acc.output,
				cache_read: acc.cacheRead,
				cache_creation: acc.cacheCreation,
			},
			messages: acc.messages,
		},
	};
}

/** The mutable running reduction for the incremental fold (cached totals carried forward, grown by the tail). */
interface TailAcc {
	readonly lines: CostLine[];
	readonly models: string[];
	readonly counted: boolean[];
	readonly keyIndex: Map<string, number>;
	readonly gate: (
		id: string | undefined,
		reqId: string | undefined,
		sidechain: boolean,
	) => boolean;
	readonly internModel: (model: string) => number;
	input: number;
	output: number;
	cacheRead: number;
	cacheCreation: number;
	total: number;
	messages: number;
	start: number;
	end: number;
}

function costLineOf(
	internModel: (model: string) => number,
	l: ParsedLine,
	cost: number,
	totalTok: number,
): CostLine {
	return {
		...(l.id !== undefined ? { id: l.id } : {}),
		...(l.requestId !== undefined ? { reqId: l.requestId } : {}),
		sidechain: l.isSidechain,
		ts: l.tsMs ?? 0,
		cost,
		...(l.model !== undefined ? { m: internModel(l.model) } : {}),
		tok: totalTok,
	};
}

/** Read + validate the appended tail: `"partial"` = only an incomplete line added; `null` = resume unsound. */
function readAppendedTail(
	cached: CostFileEntry,
	path: string,
	st: { size: number },
): { appended: ParsedLine[]; newByteOffset: number; newHeadHash: string } | "partial" | null {
	const offset = cached.byteOffset;
	if (offset === undefined || offset === 0 || st.size < offset) return null;
	const head = readRange(path, 0, headLen(offset));
	if (head === null || headHashOf(head) !== cached.headHash) return null;
	const tailBuf = readRange(path, offset, st.size);
	if (tailBuf === null) return null;
	const added = lastLineEnd(tailBuf);
	if (added === 0) return "partial";
	// The head hash covers min(HEAD_HASH_BYTES, byteOffset), which grows for a sub-4KB file — recompute it over
	// the new head (unchanged prefix ⇒ equals a full parse). Reuse the verified `head` when the range is the same.
	const newByteOffset = offset + added;
	const newHead =
		headLen(newByteOffset) === head.length ? head : readRange(path, 0, headLen(newByteOffset));
	if (newHead === null) return null;
	return {
		appended: parseAll(tailBuf.subarray(0, added).toString("utf8")),
		newByteOffset,
		newHeadHash: headHashOf(newHead),
	};
}

/** Fold one collapsed appended line into the running reduction, matching a full parse's collapse + dedup. */
/**
 * Widen `record.start`/`record.end` to span the min/max timestamp over *all* lines (a full parse's `scanBounds`),
 * not just usage-bearing ones — a trailing user/tool line is commonly the newest, and a leading summary line the
 * oldest. A stored `start` of 0 is `scanBounds`'s "no finite timestamp yet" clamp (a real timestamp is never
 * epoch 0), so the first dated line seeds it.
 */
function widenBounds(acc: TailAcc, tsMs: number | undefined): void {
	if (tsMs === undefined) return;
	if (tsMs > acc.end) acc.end = tsMs;
	if (acc.start === 0 || tsMs < acc.start) acc.start = tsMs;
}

function foldAppendedLine(acc: TailAcc, l: ParsedLine, price: PriceFn): void {
	widenBounds(acc, l.tsMs);
	const usage = l.usage;
	if (usage === undefined) return;
	const t = tokenize(usage);
	const totalTok = t.input + t.output + t.cache_read + t.c5m + t.c1h;
	const key = l.id !== undefined && l.requestId !== undefined ? `${l.id}|${l.requestId}` : null;
	const existing = key !== null ? acc.keyIndex.get(key) : undefined;
	const old = existing !== undefined ? acc.lines[existing] : undefined;
	if (existing !== undefined && old !== undefined) {
		// A later streaming write of an already-priced key: keep the higher-output one, adjusting only output.
		if (totalTok <= (old.tok ?? 0)) return;
		const cost = price(usage, l.model ?? "", l.tsMs);
		if (acc.counted[existing] === true) {
			acc.output += totalTok - (old.tok ?? 0);
			acc.total += cost - old.cost;
		}
		acc.lines[existing] = costLineOf(acc.internModel, l, cost, totalTok);
		return;
	}
	const cost = price(usage, l.model ?? "", l.tsMs);
	const isCounted = acc.gate(l.id, l.requestId, l.isSidechain);
	if (key !== null) acc.keyIndex.set(key, acc.lines.length);
	acc.lines.push(costLineOf(acc.internModel, l, cost, totalTok));
	acc.counted.push(isCounted);
	if (isCounted) {
		acc.input += t.input;
		acc.output += t.output;
		acc.cacheRead += t.cache_read;
		acc.cacheCreation += t.c5m + t.c1h;
		acc.total += cost;
		acc.messages += 1;
	}
}

interface AggLine extends CostLine {
	readonly session: string;
	readonly fileKey: string;
	readonly idx: number;
	/** The line's raw model id, resolved from its file's `models` list; omitted when the line had none. */
	readonly model?: string;
}

/**
 * Rebuild the per-session token-priced subtotals and the session→project-path map from the cached files,
 * carrying forward the authoritative `chat` map (the persisted payload costs) untouched. Dedup is **global
 * across the whole transcript tree**: every file's priced lines are merged, ordered by
 * timestamp ascending (then file key, then in-file index for a stable tie-break), and a line's cost is added
 * only on first sight of its `(id|reqId)` key — folding a `message.id`-only match when either the new line or
 * an already-counted one is a sidechain; a line with no `id` is always counted. Each surviving line's cost is
 * attributed to its file's Session, so Project and Total stay consistent (Σ project = Total).
 */
function buildAggregate(
	files: Readonly<Record<string, CostFileEntry>>,
	chat: Readonly<Record<string, number>>,
): CostAggregate {
	const sessionProject: Record<string, string> = {};
	const all: AggLine[] = [];
	for (const [fileKey, entry] of Object.entries(files)) {
		const session = String(entry.record.session);
		sessionProject[session] = entry.projectPath;
		entry.lines.forEach((line, idx) => {
			const model = line.m !== undefined ? entry.models[line.m] : undefined;
			all.push({ ...line, session, fileKey, idx, ...(model !== undefined ? { model } : {}) });
		});
	}
	all.sort(
		(a, b) =>
			a.ts - b.ts ||
			(a.fileKey < b.fileKey ? -1
			: a.fileKey > b.fileKey ? 1
			: 0) ||
			a.idx - b.idx,
	);

	const tokenPriced: Record<string, number> = {};
	const byModel: Record<string, { cost: number; tokens: number }> = {};
	const gate = makeDedupGate();
	for (const l of all) {
		if (gate(l.id, l.reqId, l.sidechain)) {
			tokenPriced[l.session] = (tokenPriced[l.session] ?? 0) + l.cost;
			if (l.model !== undefined) {
				const b = byModel[l.model] ?? { cost: 0, tokens: 0 };
				b.cost += l.cost;
				b.tokens += l.tok ?? 0;
				byModel[l.model] = b;
			}
		}
	}
	return { chat, tokenPriced, sessionProject, byModel };
}

/**
 * Scan `root/<encoded-cwd>/*.jsonl` for Project/Total cost. Re-reads + re-prices only files whose mtime/size
 * changed, reusing cached entries for the rest, and emits a full `AnalyticsRecord` per file. Gated on
 * `COST_TTL_MS` against the on-disk `cache.lastScanTs` (the process is fresh per tick).
 */
export function scanCostTree(
	root: string,
	cache: CostCache,
	clock: Clock,
	price: PriceFn,
	resolveProject: ResolveProject,
): CostCache {
	const now = clock.now();
	// Within the TTL nothing was re-read, and `buildAggregate` is a pure function of `(files, chat)` whose only
	// use of `chat` is to pass it straight through as `aggregate.chat`. So a rebuild would reproduce the cached
	// aggregate exactly — return it as-is and skip the per-tick flatten+sort+dedup on the hot render path.
	if (now - cache.lastScanTs <= COST_TTL_MS) return cache;

	const chat = cache.aggregate.chat;
	const files: Record<string, CostFileEntry> = {};
	let changed = false;
	for (const { path, encodedDir } of walkJsonl(root)) {
		const st = statSafe(path);
		if (!st) continue;
		const cached = cache.files[path];
		if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
			files[path] = cached;
		} else {
			// The active file grows every tick: tail-parse only the appended bytes when the cached prefix is
			// intact, else full reparse (a fresh file, a truncation, or a compaction rewrite).
			const resumed = cached ? resumeCostFile(cached, path, st, price) : null;
			files[path] = resumed ?? priceFile(path, encodedDir, st, price, resolveProject);
			changed = true;
		}
	}
	// When every file hit the per-file cache and none were added or removed, the deduped aggregate is exactly
	// the previous one — reuse it and just refresh the scan timestamp, skipping the whole tree flatten + sort +
	// dedup. An incremental re-merge of only-changed files would be unsound (global first-seen dedup lets an
	// interleaving timestamp steal or cede first-seen across files), so any change triggers a full rebuild.
	const sameFileSet = Object.keys(files).length === Object.keys(cache.files).length;
	if (!changed && sameFileSet) return { files, aggregate: cache.aggregate, lastScanTs: now };
	return { files, aggregate: buildAggregate(files, chat), lastScanTs: now };
}
