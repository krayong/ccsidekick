import pricingData from "../data/pricing.json";
import type { Usage } from "../sources";

const PER_MILLION = 1_000_000;

/** The five standard-API lanes, per-million-tokens in USD. */
interface Lanes {
	readonly input: number;
	readonly output: number;
	readonly cache_write_5m: number;
	readonly cache_write_1h: number;
	readonly cache_read: number;
}

/** The lanes a request bills at once its prompt exceeds `above_tokens`. */
interface LongContext extends Lanes {
	readonly above_tokens: number;
}

/**
 * One resolved price row, plus the fast-mode multiplier (default `1`) and, for a model priced by prompt size,
 * the long-context lanes.
 */
interface PriceRow extends Lanes {
	readonly fast_mult: number;
	readonly long_context?: LongContext;
}

/**
 * A row of the bundled pricing table. Mirrors the published pricing so the whole rate card lives in
 * `pricing.json`: base `input`/`output`, the two cache-write lanes and the cache-read lane, the 50%-off
 * `batch_*` lane (reference only — Claude Code makes no Batch API calls, so nothing prices against it), and the
 * `fast_mult` premium (omitted ⇒ `1`). `until` is an exclusive ISO-date upper bound for date-scoped prices.
 * `long_context` carries the rates every lane bills at once a request's prompt exceeds its `above_tokens`
 * (with the reference-only batch pair alongside).
 */
interface RawRow {
	readonly key: string;
	readonly until?: string;
	readonly input: number;
	readonly output: number;
	readonly cache_write_5m: number;
	readonly cache_write_1h: number;
	readonly cache_read: number;
	readonly batch_input: number;
	readonly batch_output: number;
	readonly fast_mult?: number;
	readonly long_context?: LongContext & {
		readonly batch_input: number;
		readonly batch_output: number;
	};
}

/** A price row tagged with the instant it stops applying (`+Infinity` when open-ended). */
interface DatedRow extends PriceRow {
	readonly untilMs: number;
}

const RAW: readonly RawRow[] = pricingData;

/**
 * Bundled table keyed by canonical model id; each key maps to its price rows sorted by `untilMs` ascending, so
 * the open-ended (current) row sorts last.
 */
const TABLE: ReadonlyMap<string, readonly DatedRow[]> = (() => {
	const byKey = new Map<string, DatedRow[]>();
	for (const r of RAW) {
		const row: DatedRow = {
			input: r.input,
			output: r.output,
			cache_write_5m: r.cache_write_5m,
			cache_write_1h: r.cache_write_1h,
			cache_read: r.cache_read,
			fast_mult: r.fast_mult ?? 1,
			...(r.long_context !== undefined ?
				{
					long_context: {
						above_tokens: r.long_context.above_tokens,
						input: r.long_context.input,
						output: r.long_context.output,
						cache_write_5m: r.long_context.cache_write_5m,
						cache_write_1h: r.long_context.cache_write_1h,
						cache_read: r.long_context.cache_read,
					},
				}
			:	{}),
			untilMs: r.until !== undefined ? Date.parse(r.until) : Number.POSITIVE_INFINITY,
		};
		const rows = byKey.get(r.key);
		if (rows) rows.push(row);
		else byKey.set(r.key, [row]);
	}
	for (const rows of byKey.values()) rows.sort((a, b) => a.untilMs - b.untilMs);
	return byKey;
})();

/** Pick the row in effect at `atMs` (earliest window that still covers it); `undefined` ⇒ the current price. */
export function pickRow(rows: readonly DatedRow[], atMs: number | undefined): PriceRow | null {
	const t = atMs ?? Number.POSITIVE_INFINITY;
	for (const r of rows) {
		if (t < r.untilMs) return r;
	}
	return rows[rows.length - 1] ?? null;
}

/** A custom-model-id → table-key alias map, parsed from `CCSIDEKICK_MODEL_ALIASES` by `sources/env`. */
type ModelAliases = ReadonlyMap<string, string>;

const NO_ALIASES: ModelAliases = new Map();

const isAlnum = (c: string): boolean => c !== "" && /[a-z0-9]/i.test(c);

/** True when `needle` occurs in `hay` flanked by non-alphanumeric boundaries (start/end count as boundaries). */
function boundaryIncludes(hay: string, needle: string): boolean {
	for (let from = 0; ;) {
		const i = hay.indexOf(needle, from);
		if (i < 0) return false;
		const before = i === 0 ? "" : hay.charAt(i - 1);
		const afterIdx = i + needle.length;
		const after = afterIdx >= hay.length ? "" : hay.charAt(afterIdx);
		if (!isAlnum(before) && !isAlnum(after)) return true;
		from = i + 1;
	}
}

/**
 * Resolve a model id to a table key: (1) exact, (2) boundary-aware substring on the `.`/`@`→`-` normalized id
 * (longest candidate wins, resolving Bedrock `anthropic.*` and Vertex `*@date` ids), (3) user aliases then a
 * trailing `-fast` strip, (4) unknown ⇒ `null`. A Bedrock ARN with no resolvable id falls through to `null`.
 */
function resolveKey(modelId: string, aliases: ModelAliases): string | null {
	if (TABLE.has(modelId)) return modelId;

	const norm = modelId.replace(/[.@]/g, "-");
	let best: string | null = null;
	for (const key of TABLE.keys()) {
		if (boundaryIncludes(norm, key) && (best === null || key.length > best.length)) best = key;
	}
	if (best !== null) return best;

	const aliased = aliases.get(modelId);
	if (aliased !== undefined) {
		const r = resolveKey(aliased, aliases);
		if (r !== null) return r;
	}
	if (modelId.endsWith("-fast")) {
		const r = resolveKey(modelId.slice(0, -"-fast".length), aliases);
		if (r !== null) return r;
	}
	return null;
}

/**
 * Resolve a model id to its price row, or `null` when unknown. `atMs` selects the row in effect at that instant
 * for a model carrying a date-scoped `until` row; omit it for the current price. No model in the bundled table
 * is date-scoped today — the lane stays live because introductory-pricing windows recur at model launches.
 */
export function resolvePrice(
	modelId: string,
	aliases: ModelAliases = NO_ALIASES,
	atMs?: number,
): PriceRow | null {
	const key = resolveKey(modelId, aliases);
	if (key === null) return null;
	const rows = TABLE.get(key);
	return rows ? pickRow(rows, atMs) : null;
}

/**
 * The canonical table key a model id resolves to, for grouping cost by model (so Bedrock `anthropic.*` and
 * Vertex `*@date` variants of one model merge). Falls back to the id itself when it resolves to nothing.
 */
export function modelKeyOf(modelId: string, aliases: ModelAliases = NO_ALIASES): string {
	return resolveKey(modelId, aliases) ?? modelId;
}

/**
 * Price one `message.usage` for `modelId`. Pure: a substring match on the normalized key, no AWS/network. An
 * unresolved id (including `<synthetic>` and ARNs with no model) prices to 0. Each cache lane uses its own
 * published rate (`cache_write_5m`, `cache_write_1h`, `cache_read`); `usage.speed === "fast"` applies the row's
 * `fast_mult`. For a model priced by prompt size, a prompt (input + cache writes + cache reads) over the row's
 * `long_context.above_tokens` bills every lane, output included, at the long-context rates. `atMs` (the message timestamp) selects the price in effect at that instant for a date-scoped
 * model; when omitted, the current price applies. The injected `aliases` map (from `sources/env`)
 * supplies user `CCSIDEKICK_MODEL_ALIASES` overrides.
 */
export function priceMessage(
	usage: Usage,
	modelId: string,
	aliases: ModelAliases = NO_ALIASES,
	atMs?: number,
): number {
	const row = resolvePrice(modelId, aliases, atMs);
	if (row === null) return 0;

	const c5m =
		usage.cache_creation ?
			usage.cache_creation.ephemeral_5m_input_tokens
		:	usage.cache_creation_input_tokens;
	const c1h = usage.cache_creation ? usage.cache_creation.ephemeral_1h_input_tokens : 0;

	const prompt = usage.input_tokens + c5m + c1h + usage.cache_read_input_tokens;
	const long = row.long_context;
	const rates: Lanes = long !== undefined && prompt > long.above_tokens ? long : row;

	const cost =
		(usage.input_tokens * rates.input +
			usage.output_tokens * rates.output +
			c5m * rates.cache_write_5m +
			c1h * rates.cache_write_1h +
			usage.cache_read_input_tokens * rates.cache_read) /
		PER_MILLION;

	const speedMult = usage.speed === "fast" ? row.fast_mult : 1;
	return cost * speedMult;
}
