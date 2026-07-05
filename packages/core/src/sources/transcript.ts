import { readFileSync, readdirSync, statSync } from "node:fs";
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
	const lines = parseAll(readSafe(path));
	const { sessionId, start, end } = scanBounds(lines);

	// Collapse each message's streaming writes to its final one before pricing, so a partial early write never
	// stands in for the completed output. One pass, pricing each usage-bearing line exactly once: every priced
	// line goes into `costLines` (for the global dedup at aggregation time); the per-file deduped survivors feed
	// the analytics record + per-file `total`.
	const priced = collapseStreaming(lines);
	const gate = makeDedupGate();
	const costLines: CostLine[] = [];
	const models: string[] = [];
	const modelIndex = new Map<string, number>();
	const internModel = (model: string): number => {
		let i = modelIndex.get(model);
		if (i === undefined) {
			i = models.length;
			models.push(model);
			modelIndex.set(model, i);
		}
		return i;
	};
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
		total,
		lines: costLines,
		models,
		projectPath,
		record,
	};
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
	for (const { path, encodedDir } of walkJsonl(root)) {
		const st = statSafe(path);
		if (!st) continue;
		const cached = cache.files[path];
		files[path] =
			cached && cached.mtime === st.mtimeMs && cached.size === st.size ?
				cached
			:	priceFile(path, encodedDir, st, price, resolveProject);
	}
	return { files, aggregate: buildAggregate(files, chat), lastScanTs: now };
}
