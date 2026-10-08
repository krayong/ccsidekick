import { expect, test } from "bun:test";

import {
	buildRows,
	mergeRows,
	parseName,
	UnknownModelError,
	type PricingRow,
} from "./refresh-pricing";

// A trimmed page mirroring the real structure: model table (with a skip row, a retired row, and the two
// date-scoped Sonnet 5 rows carrying <br>/<a> markup), plus the batch and fast-mode tables.
const FIXTURE = `
<table>
<tr><th>Model</th><th>Base Input Tokens</th><th>5m Cache Writes</th><th>1h Cache Writes</th><th>Cache Hits &amp; Refreshes</th><th>Output Tokens</th></tr>
<tr><td>Claude Fable 5.1</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$0.25 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Mythos 5.1 (<a href="x">limited availability</a>)</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$0.25 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Fable 5</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$1 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Mythos 5 (<a href="x">limited availability</a>)</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$1 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Opus 5</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Opus 4.8</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br><a href="x">through August 31, 2026</a></td><td>$2 / MTok</td><td>$2.50 / MTok</td><td>$4 / MTok</td><td>$0.20 / MTok</td><td>$10 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br>starting September 1, 2026</td><td>$3 / MTok</td><td>$3.75 / MTok</td><td>$6 / MTok</td><td>$0.30 / MTok</td><td>$15 / MTok</td></tr>
<tr><td>Claude Haiku 3.5 (<a href="x">retired, except on Bedrock and Google Cloud</a>)</td><td>$0.80 / MTok</td><td>$1 / MTok</td><td>$1.60 / MTok</td><td>$0.08 / MTok</td><td>$4 / MTok</td></tr>
</table>
<table>
<tr><th>Model</th><th>Batch input</th><th>Batch output</th></tr>
<tr><td>Claude Fable 5.1</td><td>$5 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Mythos 5.1</td><td>$5 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Fable 5</td><td>$5 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Mythos 5</td><td>$5 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Opus 5</td><td>$2.50 / MTok</td><td>$12.50 / MTok</td></tr>
<tr><td>Claude Opus 4.8</td><td>$2.50 / MTok</td><td>$12.50 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br>through August 31, 2026</td><td>$1 / MTok</td><td>$5 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br>starting September 1, 2026</td><td>$1.50 / MTok</td><td>$7.50 / MTok</td></tr>
<tr><td>Claude Haiku 3.5</td><td>$0.40 / MTok</td><td>$2 / MTok</td></tr>
</table>
<table>
<tr><th>Model</th><th>Input</th><th>Output</th></tr>
<tr><td>Claude Opus 5 / Claude Opus 4.8</td><td>$10 / MTok</td><td>$50 / MTok</td></tr>
</table>
`;

// The redesigned page: grouped two-row headers in a <thead>, a tagline span after each linked model name,
// icon-only badge buttons, an "Additional models" divider row, and Output ahead of the cache columns.
const mtok = (price: string): string => `<td><div>${price}<!-- --> <span>/ MTok</span></div></td>`;
const nameCell = (name: string, tagline = ""): string =>
	`<td rowSpan="1"><div><div><a href="x">${name}</a><span>${tagline}</span></div></div></td>`;
const divider = (span: number): string =>
	`<tr><th scope="rowgroup" colSpan="${String(span)}"><div><button><span></span>Additional models</button></div></th></tr>`;
const REDESIGNED = `
<table><thead>
<tr><th scope="colgroup">Model</th><th colSpan="2">Base tokens</th><th colSpan="3">Prompt caching</th></tr>
<tr><th>Name</th><th>Input</th><th>Output</th><th><button>5m writes</button></th><th><button>1h writes</button></th><th><button>Hits and refreshes</button></th></tr>
</thead><tbody>
<tr>${nameCell("Claude Opus 5.5", "For long-running agentic coding and knowledge work")}${mtok("$4")}${mtok("$20")}${mtok("$5")}${mtok("$8")}${mtok("<button>$0.20</button>")}</tr>
${divider(6)}
<tr><td rowSpan="1"><div><span><a href="x">Claude Mythos 5.1</a><button><span></span></button></span></div></td>${mtok("$10")}${mtok("$50")}${mtok("$12.50")}${mtok("$20")}${mtok("$0.25")}</tr>
<tr><td rowSpan="1"><div><span>Claude Opus 4.1<button><span></span></button></span></div></td>${mtok("$15")}${mtok("$75")}${mtok("$18.75")}${mtok("$30")}${mtok("$1.50")}</tr>
</tbody></table>
<table><thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead><tbody>
<tr><td>Claude Opus 5.5</td>${mtok("$8")}${mtok("$40")}</tr>
</tbody></table>
<table><thead>
<tr><th>Model</th><th colSpan="2">Batch tokens</th></tr>
<tr><th>Name</th><th>Input</th><th>Output</th></tr>
</thead><tbody>
<tr>${nameCell("Claude Opus 5.5", "For long-running agentic coding and knowledge work")}${mtok("$2")}${mtok("$10")}</tr>
${divider(3)}
<tr>${nameCell("Claude Mythos 5.1")}${mtok("$5")}${mtok("$25")}</tr>
<tr>${nameCell("Claude Opus 4.1")}${mtok("$7.50")}${mtok("$37.50")}</tr>
</tbody></table>
`;

const byId = (rows: readonly PricingRow[], key: string, until?: string): PricingRow | undefined =>
	rows.find((r) => r.key === key && r.until === until);

test("parseName splits base name, drops annotations, and reads date qualifiers", () => {
	expect(parseName("Claude Opus 4.1 (deprecated)").display).toBe("Claude Opus 4.1");
	expect(parseName("Claude Sonnet 5 through August 31, 2026").intro).toBe(true);
	expect(parseName("Claude Sonnet 5 starting September 1, 2026").startingIso).toBe("2026-09-01");
});

test("buildRows maps names to keys, skips untracked, and prices every lane", () => {
	const rows = buildRows(FIXTURE);
	expect(byId(rows, "claude-fable-5")).toMatchObject({
		input: 10,
		output: 50,
		cache_write_5m: 12.5,
		cache_write_1h: 20,
		cache_read: 1,
		batch_input: 5,
		batch_output: 25,
	});
	expect(byId(rows, "claude-fable-5-1")).toMatchObject({ input: 10, cache_read: 0.25 });
	// Every Mythos generation is intentionally untracked ⇒ absent.
	expect(rows.some((r) => r.key.includes("mythos"))).toBe(false);
	// Haiku 3.5 maps to the API-style key.
	expect(byId(rows, "claude-3-5-haiku")?.input).toBe(0.8);
});

test("buildRows derives the fast multiplier from the fast table (10/5 = 2)", () => {
	const opus = byId(buildRows(FIXTURE), "claude-opus-4-8");
	expect(opus?.fast_mult).toBe(2);
});

// The page bills one fast lane for several models by listing them in a single slash-separated cell
// ("Claude Opus 5 / Claude Opus 4.8"). Keying the map on the raw cell matches no model, which silently
// drops fast_mult from every row and under-prices fast messages by the multiplier.
test("buildRows applies a slash-combined fast row to every model it names", () => {
	const rows = buildRows(FIXTURE);
	expect(byId(rows, "claude-opus-5")?.fast_mult).toBe(2);
	expect(byId(rows, "claude-opus-4-8")?.fast_mult).toBe(2);
});

test("buildRows produces two Sonnet 5 rows: intro with an until, standard open-ended", () => {
	const rows = buildRows(FIXTURE);
	expect(byId(rows, "claude-sonnet-5", "2026-09-01")).toMatchObject({ input: 2, batch_input: 1 });
	const std = byId(rows, "claude-sonnet-5", undefined);
	expect(std).toMatchObject({ input: 3, batch_input: 1.5 });
	expect(std?.fast_mult).toBeUndefined();
});

test("an unmapped model name throws UnknownModelError naming it", () => {
	const html = FIXTURE.replace("Claude Fable 5</td>", "Claude Nebula 9</td>");
	expect(() => buildRows(html)).toThrow(UnknownModelError);
	try {
		buildRows(html);
	} catch (e) {
		expect((e as UnknownModelError).names).toContain("Claude Nebula 9");
	}
});

test("mergeRows updates on-page rows in place, preserves historical, appends new", () => {
	const existing: PricingRow[] = [
		{
			key: "claude-opus-4-8",
			input: 999,
			output: 25,
			cache_write_5m: 6.25,
			cache_write_1h: 10,
			cache_read: 0.5,
			batch_input: 2.5,
			batch_output: 12.5,
			fast_mult: 2,
		},
		{
			key: "claude-3-opus",
			input: 15,
			output: 75,
			cache_write_5m: 18.75,
			cache_write_1h: 30,
			cache_read: 1.5,
			batch_input: 7.5,
			batch_output: 37.5,
		},
	];
	const merged = mergeRows(existing, buildRows(FIXTURE));
	// on-page row updated in place (stale 999 → 5), keeping its position first
	expect(merged[0]?.key).toBe("claude-opus-4-8");
	expect(merged[0]?.input).toBe(5);
	// historical row absent from the page is preserved
	expect(byId(merged, "claude-3-opus")?.input).toBe(15);
	// a brand-new on-page key (fable-5) is appended
	expect(byId(merged, "claude-fable-5")).toBeDefined();
});

// The fast table lists only models currently offering a fast lane. When one drops off (Opus 4.7 did),
// transcripts recorded while it was offered still need the old multiplier to price correctly, so an
// established fast_mult carries forward instead of silently reverting those messages to ×1.
test("mergeRows carries an established fast_mult forward when the fast table drops the model", () => {
	const existing: PricingRow[] = [
		{
			key: "claude-opus-4-8",
			input: 5,
			output: 25,
			cache_write_5m: 6.25,
			cache_write_1h: 10,
			cache_read: 0.5,
			batch_input: 2.5,
			batch_output: 12.5,
			fast_mult: 6,
		},
	];
	// FIXTURE's fast table prices opus-4-8 at ×2, so a listed model is still re-derived, not frozen.
	expect(byId(mergeRows(existing, buildRows(FIXTURE)), "claude-opus-4-8")?.fast_mult).toBe(2);

	// With the model absent from the fast table, the established multiplier survives.
	const noFastTable = FIXTURE.replace("Claude Opus 5 / Claude Opus 4.8", "Claude Fable 5");
	expect(byId(mergeRows(existing, buildRows(noFastTable)), "claude-opus-4-8")?.fast_mult).toBe(6);
});

test("buildRows reads the redesigned layout: grouped headers, taglines, and a divider row", () => {
	const rows = buildRows(REDESIGNED);
	expect(byId(rows, "claude-opus-5-5")).toEqual({
		key: "claude-opus-5-5",
		input: 4,
		output: 20,
		cache_write_5m: 5,
		cache_write_1h: 8,
		cache_read: 0.2,
		batch_input: 2,
		batch_output: 10,
		fast_mult: 2,
	});
	expect(byId(rows, "claude-opus-4-1")).toMatchObject({
		input: 15,
		output: 75,
		batch_input: 7.5,
	});
	expect(rows.some((r) => r.key.includes("mythos"))).toBe(false);
});

// A new release in a known family maps by the naming convention, so the daily refresh opens a PR for it
// instead of an issue; only a name outside the known families still needs a human.
test("buildRows derives keys for unseen releases in known families", () => {
	const html = REDESIGNED.replaceAll("Claude Opus 5.5", "Claude Sonnet 6.1").replaceAll(
		"Claude Mythos 5.1",
		"Claude Mythos 7",
	);
	const rows = buildRows(html);
	expect(byId(rows, "claude-sonnet-6-1")?.input).toBe(4);
	expect(rows.some((r) => r.key.includes("mythos"))).toBe(false);
});

// A model priced by prompt size spans two rows: the name cell carries rowSpan="2", the first row holds the rates
// "for prompts up to N tokens" and the continuation row (one cell short) holds the rates "for prompts over N".
const tierNote = (price: string, note: string): string =>
	`<td><div>${price}<!-- --> <span>/ MTok</span><span>${note}</span></div></td>`;
const haikuName = `<td rowSpan="2"><div><div><a href="x">Claude Haiku 5.5</a><span>For high-volume, latency-sensitive tasks</span></div></div></td>`;
const TIERED = `
<table><thead>
<tr><th scope="colgroup">Model</th><th colSpan="2">Base tokens</th><th colSpan="3">Prompt caching</th></tr>
<tr><th>Name</th><th>Input</th><th>Output</th><th>5m writes</th><th>1h writes</th><th>Hits and refreshes</th></tr>
</thead><tbody>
<tr>${haikuName}${tierNote("$0.10", "for prompts up to 100,000 tokens")}${mtok("$0.50")}${mtok("$0.125")}${mtok("$0.20")}${mtok("$0.01")}</tr>
<tr>${tierNote("$0.50", "for prompts over 100,000 tokens")}${mtok("$2.50")}${mtok("$0.625")}${mtok("$1")}${mtok("$0.05")}</tr>
<tr>${nameCell("Claude Haiku 4.5")}${mtok("$1")}${mtok("$5")}${mtok("$1.25")}${mtok("$2")}${mtok("$0.10")}</tr>
</tbody></table>
<table><thead>
<tr><th>Model</th><th colSpan="2">Batch tokens</th></tr>
<tr><th>Name</th><th>Input</th><th>Output</th></tr>
</thead><tbody>
<tr>${haikuName}${tierNote("$0.05", "for prompts up to 100,000 tokens")}${mtok("$0.25")}</tr>
<tr>${tierNote("$0.25", "for prompts over 100,000 tokens")}${mtok("$1.25")}</tr>
<tr>${nameCell("Claude Haiku 4.5")}${mtok("$0.50")}${mtok("$2.50")}</tr>
</tbody></table>
`;

test("buildRows folds a rowSpan'd prompt-size tier into one row with a long_context block", () => {
	const rows = buildRows(TIERED);
	expect(rows.filter((r) => r.key === "claude-haiku-5-5")).toHaveLength(1);
	expect(byId(rows, "claude-haiku-5-5")).toEqual({
		key: "claude-haiku-5-5",
		input: 0.1,
		output: 0.5,
		cache_write_5m: 0.125,
		cache_write_1h: 0.2,
		cache_read: 0.01,
		batch_input: 0.05,
		batch_output: 0.25,
		long_context: {
			above_tokens: 100_000,
			input: 0.5,
			output: 2.5,
			cache_write_5m: 0.625,
			cache_write_1h: 1,
			cache_read: 0.05,
			batch_input: 0.25,
			batch_output: 1.25,
		},
	});
	// The row after the span is untouched by it.
	expect(byId(rows, "claude-haiku-4-5")).toMatchObject({ input: 1, batch_input: 0.5 });
	expect(byId(rows, "claude-haiku-4-5")?.long_context).toBeUndefined();
});
