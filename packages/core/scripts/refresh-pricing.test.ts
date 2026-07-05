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
<tr><td>Claude Fable 5</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$1 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Mythos 5 (<a href="x">limited availability</a>)</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$1 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Opus 4.8</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br><a href="x">through August 31, 2026</a></td><td>$2 / MTok</td><td>$2.50 / MTok</td><td>$4 / MTok</td><td>$0.20 / MTok</td><td>$10 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br>starting September 1, 2026</td><td>$3 / MTok</td><td>$3.75 / MTok</td><td>$6 / MTok</td><td>$0.30 / MTok</td><td>$15 / MTok</td></tr>
<tr><td>Claude Haiku 3.5 (<a href="x">retired, except on Bedrock and Google Cloud</a>)</td><td>$0.80 / MTok</td><td>$1 / MTok</td><td>$1.60 / MTok</td><td>$0.08 / MTok</td><td>$4 / MTok</td></tr>
</table>
<table>
<tr><th>Model</th><th>Batch input</th><th>Batch output</th></tr>
<tr><td>Claude Fable 5</td><td>$5 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Mythos 5</td><td>$5 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Opus 4.8</td><td>$2.50 / MTok</td><td>$12.50 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br>through August 31, 2026</td><td>$1 / MTok</td><td>$5 / MTok</td></tr>
<tr><td>Claude Sonnet 5<br>starting September 1, 2026</td><td>$1.50 / MTok</td><td>$7.50 / MTok</td></tr>
<tr><td>Claude Haiku 3.5</td><td>$0.40 / MTok</td><td>$2 / MTok</td></tr>
</table>
<table>
<tr><th>Model</th><th>Input</th><th>Output</th></tr>
<tr><td>Claude Opus 4.8</td><td>$10 / MTok</td><td>$50 / MTok</td></tr>
</table>
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
	// Mythos 5 is intentionally untracked ⇒ absent.
	expect(rows.some((r) => r.key.includes("mythos"))).toBe(false);
	// Haiku 3.5 maps to the API-style key.
	expect(byId(rows, "claude-3-5-haiku")?.input).toBe(0.8);
});

test("buildRows derives the fast multiplier from the fast table (10/5 = 2)", () => {
	const opus = byId(buildRows(FIXTURE), "claude-opus-4-8");
	expect(opus?.fast_mult).toBe(2);
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
