import { join } from "node:path";

import { asProject, asSession, type Project, type Session } from "../domain";

import { atomicWrite, cacheDir, readJson, withLock } from "./storage";

/** One transcript file's reduced analytics record; `session` is the join key into `analytics/store.json`. */
export interface AnalyticsRecord {
	readonly session: Session;
	readonly project: Project;
	readonly start: number;
	readonly end: number;
	readonly tokens: {
		readonly input: number;
		readonly output: number;
		readonly cache_read: number;
		readonly cache_creation: number;
	};
	readonly messages: number;
}

/**
 * One usage-bearing transcript line, reduced to what global dedup + pricing need. `id`/`reqId` form the dedup
 * key `${id}|${reqId}`; a line with no `id` is always counted. `ts` orders the global first-seen pass. `cost`
 * is the line's already-priced USD. These per-line deltas let the dedup run globally across files at
 * aggregation time while the per-file scan stays cached by mtime/size.
 */
export interface CostLine {
	readonly id?: string;
	readonly reqId?: string;
	readonly sidechain: boolean;
	readonly ts: number;
	readonly cost: number;
	/** Index into the file entry's `models` list; omitted when the line carries no model id. */
	readonly m?: number;
	/** Total tokens on the line (input + output + cache read + cache creation), for per-model token sums. */
	readonly tok?: number;
}

/** Per-transcript cache row: the `stat` cache key, the file's priced lines, the cwd project key, and the analytics record. */
export interface CostFileEntry {
	readonly mtime: number;
	readonly size: number;
	/**
	 * Byte offset of the end of the last complete (newline-terminated) line priced into this entry — the resume
	 * point for an incremental tail-parse. Absent on entries written before tail-parse existed (they full-reparse
	 * once). A trailing partial line is excluded, so `byteOffset ≤ size`.
	 */
	readonly byteOffset?: number;
	/** FNV-1a hash of the file's first bytes; a mismatch on resume means the prefix was rewritten (compaction) ⇒ full reparse. */
	readonly headHash?: string;
	/** Per-file deduped total (the analytics-side subtotal); Project/Total are summed from `lines` globally. */
	readonly total: number;
	/** Every usage-bearing line, priced, for the global first-seen dedup at aggregation time. */
	readonly lines: readonly CostLine[];
	/** Distinct raw model ids seen in this file, first-seen order; `CostLine.m` indexes into this list. */
	readonly models: readonly string[];
	/** The session's cwd path key (decoded transcript dir), the cost-side Project key. */
	readonly projectPath: string;
	readonly record: AnalyticsRecord;
}

/** Deduped cost + token totals for one model, summed across the whole transcript tree. */
interface ModelSpend {
	readonly cost: number;
	readonly tokens: number;
}

/**
 * The cost reconciliation inputs, all keyed by Session. `chat` is the authoritative per-session payload cost,
 * persisted across ticks; `tokenPriced` and `sessionProject` are rebuilt from the per-file scan each refresh
 * via a global first-seen dedup across all files.
 * `deriveCost` reconciles these into Chat / Project / Total. One vocabulary shared by the scan and the store.
 */
export interface CostAggregate {
	/** Authoritative `cost.total_cost_usd` per Session, remembered across ticks; the "default" session is never stored. */
	readonly chat: Readonly<Record<string, number>>;
	/** Token-priced subtotal per Session, from the latest scan. */
	readonly tokenPriced: Readonly<Record<string, number>>;
	/** Session → cwd path key, from the latest scan. */
	readonly sessionProject: Readonly<Record<string, string>>;
	/** Deduped cost + tokens per raw model id, summed across every session; rebuilt each scan. */
	readonly byModel: Readonly<Record<string, ModelSpend>>;
}

/** The cost engine's per-file cache plus the keyed warm-start aggregate; `lastScanTs` gates the `COST_TTL_MS` re-scan. */
export interface CostCache {
	readonly files: Readonly<Record<string, CostFileEntry>>;
	readonly aggregate: CostAggregate;
	readonly lastScanTs: number;
}

const COST_FILE = "cost.json";

const EMPTY: CostCache = {
	files: {},
	aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
	lastScanTs: 0,
};

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asNumberRecord(v: unknown): Record<string, number> {
	if (!isObject(v)) return {};
	const out: Record<string, number> = {};
	for (const [key, raw] of Object.entries(v)) {
		const n = asNumber(raw);
		if (n !== undefined) out[key] = n;
	}
	return out;
}

function asStringRecord(v: unknown): Record<string, string> {
	if (!isObject(v)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(v)) {
		if (typeof raw === "string") out[key] = raw;
	}
	return out;
}

function coerceTokens(v: unknown): AnalyticsRecord["tokens"] | undefined {
	if (!isObject(v)) return undefined;
	const input = asNumber(v["input"]);
	const output = asNumber(v["output"]);
	const cache_read = asNumber(v["cache_read"]);
	const cache_creation = asNumber(v["cache_creation"]);
	if (
		input === undefined ||
		output === undefined ||
		cache_read === undefined ||
		cache_creation === undefined
	) {
		return undefined;
	}
	return { input, output, cache_read, cache_creation };
}

function coerceRecord(v: unknown): AnalyticsRecord | undefined {
	if (!isObject(v)) return undefined;
	const session = v["session"];
	const project = v["project"];
	const start = asNumber(v["start"]);
	const end = asNumber(v["end"]);
	const messages = asNumber(v["messages"]);
	const tokens = coerceTokens(v["tokens"]);
	if (
		typeof session !== "string" ||
		typeof project !== "string" ||
		start === undefined ||
		end === undefined ||
		messages === undefined ||
		tokens === undefined
	) {
		return undefined;
	}
	return {
		session: asSession(session),
		project: asProject(project),
		start,
		end,
		tokens,
		messages,
	};
}

function coerceLine(v: unknown): CostLine | undefined {
	if (!isObject(v)) return undefined;
	const ts = asNumber(v["ts"]);
	const cost = asNumber(v["cost"]);
	if (ts === undefined || cost === undefined) return undefined;
	const id = typeof v["id"] === "string" ? v["id"] : undefined;
	const reqId = typeof v["reqId"] === "string" ? v["reqId"] : undefined;
	const m = asNumber(v["m"]);
	const tok = asNumber(v["tok"]);
	return {
		...(id !== undefined ? { id } : {}),
		...(reqId !== undefined ? { reqId } : {}),
		sidechain: v["sidechain"] === true,
		ts,
		cost,
		...(m !== undefined ? { m } : {}),
		...(tok !== undefined ? { tok } : {}),
	};
}

function coerceLines(v: unknown): CostLine[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: CostLine[] = [];
	for (const item of v) {
		const line = coerceLine(item);
		if (line !== undefined) out.push(line);
	}
	return out;
}

function coerceEntry(v: unknown): CostFileEntry | undefined {
	if (!isObject(v)) return undefined;
	const mtime = asNumber(v["mtime"]);
	const size = asNumber(v["size"]);
	const total = asNumber(v["total"]);
	const lines = coerceLines(v["lines"]);
	const record = coerceRecord(v["record"]);
	if (
		mtime === undefined ||
		size === undefined ||
		total === undefined ||
		lines === undefined ||
		record === undefined
	) {
		return undefined;
	}
	const projectPath =
		typeof v["projectPath"] === "string" ? v["projectPath"] : String(record.project);
	const models =
		Array.isArray(v["models"]) ?
			v["models"].filter((x): x is string => typeof x === "string")
		:	[];
	const byteOffset = asNumber(v["byteOffset"]);
	const headHash = typeof v["headHash"] === "string" ? v["headHash"] : undefined;
	return {
		mtime,
		size,
		total,
		lines,
		models,
		projectPath,
		record,
		...(byteOffset !== undefined ? { byteOffset } : {}),
		...(headHash !== undefined ? { headHash } : {}),
	};
}

function coerceByModel(v: unknown): Record<string, ModelSpend> {
	if (!isObject(v)) return {};
	const out: Record<string, ModelSpend> = {};
	for (const [key, raw] of Object.entries(v)) {
		if (!isObject(raw)) continue;
		const cost = asNumber(raw["cost"]);
		const tokens = asNumber(raw["tokens"]);
		if (cost !== undefined && tokens !== undefined) out[key] = { cost, tokens };
	}
	return out;
}

/** Field-coerce a parsed cost cache; any wrong-shaped store degrades to the cold default. */
function coerceCache(raw: unknown): CostCache {
	if (!isObject(raw)) return EMPTY;
	const files: Record<string, CostFileEntry> = {};
	const rawFiles = raw["files"];
	if (isObject(rawFiles)) {
		for (const [key, value] of Object.entries(rawFiles)) {
			const entry = coerceEntry(value);
			if (entry !== undefined) files[key] = entry;
		}
	}
	const agg = isObject(raw["aggregate"]) ? raw["aggregate"] : {};
	return {
		files,
		aggregate: {
			chat: asNumberRecord(agg["chat"]),
			tokenPriced: asNumberRecord(agg["tokenPriced"]),
			sessionProject: asStringRecord(agg["sessionProject"]),
			byModel: coerceByModel(agg["byModel"]),
		},
		lastScanTs: asNumber(raw["lastScanTs"]) ?? 0,
	};
}

function costPath(root: string): string {
	return join(cacheDir(root), COST_FILE);
}

/** Lock-guarded read; a held lock falls back to the read-only path (still returns the on-disk value). */
export function readCostCache(root: string): CostCache {
	const path = costPath(root);
	const read = (): CostCache => coerceCache(readJson<unknown>(path, undefined));
	return withLock(`${path}.lock`, read, read);
}

/** `O_EXCL` lock + atomic write; under a held lock the write is skipped rather than blocking the render. */
export function writeCostCache(root: string, c: CostCache): void {
	const path = costPath(root);
	withLock(
		`${path}.lock`,
		() => {
			atomicWrite(path, JSON.stringify(c));
		},
		() => {
			/* lock held: skip the write */
		},
	);
}
