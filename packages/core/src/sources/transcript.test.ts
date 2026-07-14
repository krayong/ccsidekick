import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { asProject, asSession, COST_TTL_MS } from "../domain";

import { fixedClock } from "./clock";
import {
	projectKeyForTranscript,
	scanCostTree,
	scanTranscript,
	type CostCache,
	type PriceFn,
	type ResolveProject,
	type Usage,
} from "./transcript";

const FIXTURE = join(import.meta.dir, "../../test/fixtures/transcripts/session.jsonl");
const NOW = Date.parse("2026-01-01T05:00:00.000Z"); // 1h after the fixture lines ⇒ all inside the 5h window
const clock = fixedClock(NOW);

const sumIO: PriceFn = (u: Usage) => u.input_tokens + u.output_tokens;

test("projectKeyForTranscript: keys by the transcript's own directory, not the live cwd", () => {
	// A session filed under `-Users-krayong-ccsidekick` keeps that project key even after a mid-session `cd`
	// moves the live cwd into a subdirectory, so Project still matches every sibling session in the same dir.
	expect(
		projectKeyForTranscript("/home/u/.claude/projects/-Users-krayong-ccsidekick/abc.jsonl"),
	).toBe("/Users/krayong/ccsidekick");
});

test("projectKeyForTranscript: undefined when no transcript path is known", () => {
	expect(projectKeyForTranscript("")).toBeUndefined();
});

test("scanTranscript: dedup, token sums, compaction, todo, speed, burn", () => {
	const s = scanTranscript(FIXTURE, clock, sumIO);
	// counted = L1(A), L3(B sidechain), L5(no id), L8(C); the two repeats fold away.
	expect(s.messages).toBe(4);
	expect(s.tokens.input).toBe(111); // 10 + 100 + 0 + 1
	expect(s.tokens.output).toBe(12); // 5 + 0 + 7 + 0
	expect(s.tokens.cache_read).toBe(2);
	expect(s.tokens.cache_creation_5m).toBe(3); // no breakdown ⇒ all 5-minute
	expect(s.tokens.cache_creation_1h).toBe(0);
	expect(s.compactions).toBe(1);
	expect(s.speed).toBe("fast"); // latest counted speed
	expect(s.todos).toEqual([
		{ content: "do x", status: "in_progress" },
		{ content: "done y", status: "completed" },
	]);
	expect(s.inProgressSinceMs).toBe(Date.parse("2026-01-01T04:00:06.000Z"));
	expect(s.burn).toHaveLength(4);
	const burnA = s.burn.find((b) => b.tokens === 20); // L1: 10+5+2+3
	expect(burnA?.costUsd).toBe(15); // sumIO: 10 + 5
});

test("scanTranscript: mtime/size gate returns the prior scan unchanged", () => {
	const first = scanTranscript(FIXTURE, clock, sumIO);
	const again = scanTranscript(FIXTURE, clock, sumIO, first);
	expect(again).toBe(first); // identity: not re-scanned
});

test("scanTranscript: missing file ⇒ empty scan, never throws", () => {
	const s = scanTranscript(join(tmpdir(), "nope-xyz.jsonl"), clock, sumIO);
	expect(s.messages).toBe(0);
	expect(s.todos).toEqual([]);
	expect(s.burn).toEqual([]);
});

// --- scanCostTree ------------------------------------------------------------

const LINE = (session: string, id: string, req: string, input: number): string =>
	JSON.stringify({
		type: "assistant",
		sessionId: session,
		requestId: req,
		timestamp: "2026-01-01T04:00:00.000Z",
		message: {
			id,
			model: "claude-x",
			usage: {
				input_tokens: input,
				output_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
	});

function projectsTree(): { root: string; encA: string; encB: string } {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-"));
	const encA = "-Users-me-repoA";
	const encB = "-Users-me-repoB";
	mkdirSync(join(root, encA));
	mkdirSync(join(root, encB));
	// file A: two lines sharing (id,requestId) ⇒ deduped to one priced line (input 50)
	writeFileSync(
		join(root, encA, "s1.jsonl"),
		`${LINE("s1", "M", "Q", 50)}\n${LINE("s1", "M", "Q", 50)}\n`,
	);
	writeFileSync(join(root, encB, "s2.jsonl"), `${LINE("s2", "N", "Q", 20)}\n`);
	return { root, encA, encB };
}

const inputPrice: PriceFn = (u: Usage) => u.input_tokens;
const decodedResolver: ResolveProject = (_session, decodedCwd) => decodedCwd;
const COST_NOW = 10_000_000_000; // far past any lastScanTs ⇒ the walk runs

// A usage line with an explicit output_tokens (for streaming) and optional sidechain flag.
const oline = (o: { id: string; req: string; output: number; sidechain?: boolean }): string =>
	JSON.stringify({
		type: "assistant",
		sessionId: "s1",
		requestId: o.req,
		...(o.sidechain === true ? { isSidechain: true } : {}),
		timestamp: "2026-01-01T04:00:00.000Z",
		message: {
			id: o.id,
			model: "claude-x",
			usage: {
				input_tokens: 0,
				output_tokens: o.output,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
	});

const outPrice: PriceFn = (u: Usage) => u.output_tokens;

test("scanCostTree: incremental tail-parse of a grown file equals a full parse, pricing only the tail", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-inc-"));
	const enc = "-Users-me-repoA";
	mkdirSync(join(root, enc));
	const file = join(root, enc, "s1.jsonl");

	// Tick 1: four plain messages + a streaming message B (writes 100 then 300).
	const head = [
		oline({ id: "A", req: "Q1", output: 10 }),
		oline({ id: "P1", req: "R1", output: 5 }),
		oline({ id: "P2", req: "R2", output: 5 }),
		oline({ id: "P3", req: "R3", output: 5 }),
		oline({ id: "B", req: "Q2", output: 100 }),
		oline({ id: "B", req: "Q2", output: 300 }),
	];
	// Tick 2 appends: B's final streaming write (500, replaces 300 across the boundary), a new message C, and a
	// sidechain re-log of A's message.id under a new requestId (folds by message.id ⇒ not counted).
	const tail = [
		oline({ id: "B", req: "Q2", output: 500 }),
		oline({ id: "C", req: "Q3", output: 50 }),
		oline({ id: "A", req: "Q4", output: 20, sidechain: true }),
	];

	try {
		const empty: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};

		// Tick 1.
		writeFileSync(file, `${head.join("\n")}\n`);
		const cache1 = scanCostTree(root, empty, fixedClock(COST_NOW), outPrice, decodedResolver);

		// Tick 2 (file grew): count price() calls to prove only the tail is priced.
		writeFileSync(file, `${[...head, ...tail].join("\n")}\n`);
		let incCalls = 0;
		const countingPrice: PriceFn = (u) => {
			incCalls++;
			return u.output_tokens;
		};
		const cache2 = scanCostTree(
			root,
			cache1,
			fixedClock(COST_NOW + COST_TTL_MS + 1),
			countingPrice,
			decodedResolver,
		);

		// Reference: a full parse of the final file from a cold cache.
		const full = scanCostTree(
			root,
			empty,
			fixedClock(COST_NOW + COST_TTL_MS + 1),
			outPrice,
			decodedResolver,
		);

		// Incremental entry is byte-identical to the full parse.
		expect(cache2.files[file]).toEqual(full.files[file]);
		// Deduped total = A(10)+P1(5)+P2(5)+P3(5)+B(500)+C(50) = 575; the sidechain A/Q4 folds out.
		expect(cache2.files[file]!.total).toBe(575);
		expect(cache2.files[file]!.record.messages).toBe(6);
		// Only the three tail lines were priced — not the four unchanged head messages (a full reparse = 7).
		expect(incCalls).toBe(3);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// Each row: how the file changes on tick 2, and whether the change keeps the cached prefix intact. Either way
// the scan must produce a byte-identical entry to a cold full parse of the final file.
const incrementalCases: { name: string; tick1: string[]; tick2: string[] }[] = [
	{
		name: "compaction rewrite (changed prefix, larger) full-reparses",
		tick1: [
			oline({ id: "A", req: "Q1", output: 10 }),
			oline({ id: "B", req: "Q2", output: 20 }),
			oline({ id: "C", req: "Q3", output: 30 }),
		],
		// A summary replaces the head, then new turns — the prefix bytes differ, so the head hash won't match.
		tick2: [
			oline({ id: "SUM", req: "Z0", output: 1 }),
			oline({ id: "D", req: "Q4", output: 40 }),
			oline({ id: "E", req: "Q5", output: 50 }),
			oline({ id: "F", req: "Q6", output: 60 }),
		],
	},
	{
		name: "truncation (file shrank) full-reparses",
		tick1: [
			oline({ id: "A", req: "Q1", output: 10 }),
			oline({ id: "B", req: "Q2", output: 20 }),
			oline({ id: "C", req: "Q3", output: 30 }),
			oline({ id: "D", req: "Q4", output: 40 }),
		],
		tick2: [oline({ id: "A", req: "Q1", output: 10 })],
	},
	{
		name: "two successive grows resume correctly",
		tick1: [
			oline({ id: "A", req: "Q1", output: 10 }),
			oline({ id: "B", req: "Q2", output: 100 }),
		],
		// note: tick2 keeps tick1's exact prefix and appends (this row is grown a second time below)
		tick2: [
			oline({ id: "A", req: "Q1", output: 10 }),
			oline({ id: "B", req: "Q2", output: 100 }),
			oline({ id: "B", req: "Q2", output: 250 }),
			oline({ id: "C", req: "Q3", output: 30 }),
		],
	},
];

test.each(incrementalCases)("scanCostTree incremental: $name equals a full parse", (c) => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-inc-"));
	const enc = "-Users-me-repoA";
	mkdirSync(join(root, enc));
	const file = join(root, enc, "s1.jsonl");
	const empty: CostCache = {
		files: {},
		aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
		lastScanTs: 0,
	};
	try {
		writeFileSync(file, `${c.tick1.join("\n")}\n`);
		const cache1 = scanCostTree(root, empty, fixedClock(COST_NOW), outPrice, decodedResolver);
		writeFileSync(file, `${c.tick2.join("\n")}\n`);
		const t2 = fixedClock(COST_NOW + COST_TTL_MS + 1);
		const cache2 = scanCostTree(root, cache1, t2, outPrice, decodedResolver);
		const full = scanCostTree(root, empty, t2, outPrice, decodedResolver);
		expect(cache2.files[file]).toEqual(full.files[file]);
		expect(cache2.aggregate.tokenPriced).toEqual(full.aggregate.tokenPriced);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: global dedup, token-priced subtotals + session→project-path map", () => {
	const { root } = projectsTree();
	try {
		const cache: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), inputPrice, decodedResolver);
		expect(scan.aggregate.tokenPriced["s1"]).toBe(50); // A deduped to one line
		expect(scan.aggregate.tokenPriced["s2"]).toBe(20);
		expect(scan.aggregate.sessionProject["s1"]).toBe("/Users/me/repoA");
		expect(scan.aggregate.sessionProject["s2"]).toBe("/Users/me/repoB");
		const entryA = Object.values(scan.files).find((f) => f.record.session === "s1");
		expect(entryA?.record.tokens.input).toBe(50);
		expect(entryA?.record.messages).toBe(1); // deduped
		expect(entryA?.record.project).toBe(asProject("/Users/me/repoA"));
		expect(entryA?.projectPath).toBe("/Users/me/repoA");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: collapses a message's streaming writes to its final (max-output) usage", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-"));
	try {
		const enc = "-Users-me-repoA";
		mkdirSync(join(root, enc));
		const line = (out: number): string =>
			JSON.stringify({
				type: "assistant",
				sessionId: "s1",
				requestId: "Q",
				timestamp: "2026-01-01T04:00:00.000Z",
				message: {
					id: "M",
					model: "claude-x",
					usage: {
						input_tokens: 10,
						output_tokens: out,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			});
		// the same (id, requestId) streamed three times with growing output — only the final write counts
		writeFileSync(join(root, enc, "s1.jsonl"), `${line(100)}\n${line(300)}\n${line(500)}\n`);
		const outputPrice: PriceFn = (u: Usage) => u.output_tokens;
		const cache: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), outputPrice, decodedResolver);
		expect(scan.aggregate.tokenPriced["s1"]).toBe(500); // final write, not 100 (first) or 900 (summed)
		const entry = Object.values(scan.files).find((f) => f.record.session === "s1");
		expect(entry?.record.tokens.output).toBe(500);
		expect(entry?.record.messages).toBe(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: recurses into nested sub-agent transcripts and prices them under the top-level project", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-"));
	try {
		const enc = "-Users-me-repoA";
		mkdirSync(join(root, enc, "sess-uuid", "subagents"), { recursive: true });
		// the top-level session transcript
		writeFileSync(join(root, enc, "main.jsonl"), `${LINE("s1", "M", "Q", 50)}\n`);
		// a Task sub-agent transcript nested two levels deeper, sharing the parent sessionId
		writeFileSync(
			join(root, enc, "sess-uuid", "subagents", "agent-x.jsonl"),
			`${LINE("s1", "SUB", "R", 30)}\n`,
		);
		const cache: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), inputPrice, decodedResolver);
		expect(Object.keys(scan.files).length).toBe(2); // both the main file and the nested sub-agent file
		expect(scan.aggregate.tokenPriced["s1"]).toBe(80); // 50 (main) + 30 (sub-agent)
		expect(scan.aggregate.sessionProject["s1"]).toBe("/Users/me/repoA");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: within TTL reuses the cached aggregate without rebuilding it", () => {
	const { root } = projectsTree();
	try {
		const aggregate = {
			chat: { s0: 1 },
			tokenPriced: { s1: 9 },
			sessionProject: { s1: "/p" },
			byModel: {},
		};
		const cache: CostCache = { files: {}, aggregate, lastScanTs: COST_NOW };
		// The clock is only 100ms past lastScanTs — inside COST_TTL_MS (5000ms) — so the tree must not be
		// re-walked and the aggregate must not be rebuilt; the exact same object is returned.
		const scan = scanCostTree(
			root,
			cache,
			fixedClock(COST_NOW + 100),
			inputPrice,
			decodedResolver,
		);
		expect(scan.aggregate).toBe(aggregate);
		expect(scan.files).toBe(cache.files);
		expect(scan.lastScanTs).toBe(COST_NOW);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: after the TTL, an unchanged tree reuses the aggregate without rebuilding (P7)", () => {
	const { root } = projectsTree();
	try {
		const empty: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const first = scanCostTree(root, empty, fixedClock(COST_NOW), inputPrice, decodedResolver);
		// A second scan well past the TTL, with no file added/removed/modified: every file hits the per-file
		// cache, so the deduped aggregate is reused (reference-equal), not flattened+sorted+deduped again.
		const second = scanCostTree(
			root,
			first,
			fixedClock(COST_NOW + COST_TTL_MS + 1000),
			inputPrice,
			decodedResolver,
		);
		expect(second.aggregate).toBe(first.aggregate);
		expect(second.lastScanTs).toBe(COST_NOW + COST_TTL_MS + 1000); // timestamp still refreshed
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: byModel sums deduped cost + tokens per model (interned across a file)", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-"));
	try {
		const enc = "-Users-me-repo";
		mkdirSync(join(root, enc));
		const line = (id: string, req: string, model: string, input: number): string =>
			JSON.stringify({
				type: "assistant",
				sessionId: "s1",
				requestId: req,
				timestamp: "2026-01-01T04:00:00.000Z",
				message: {
					id,
					model,
					usage: {
						input_tokens: input,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			});
		// opus line (input 50) + an exact duplicate (folds away) + a sonnet line (input 20)
		writeFileSync(
			join(root, enc, "s1.jsonl"),
			`${line("A", "Q", "claude-opus-4-8", 50)}\n${line("A", "Q", "claude-opus-4-8", 50)}\n${line("B", "R", "claude-sonnet-5", 20)}\n`,
		);
		const cache: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), inputPrice, decodedResolver);
		// opus deduped to one line (cost 50, tokens 50); sonnet a single line (cost 20, tokens 20)
		expect(scan.aggregate.byModel["claude-opus-4-8"]).toEqual({ cost: 50, tokens: 50 });
		expect(scan.aggregate.byModel["claude-sonnet-5"]).toEqual({ cost: 20, tokens: 20 });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: a line shared across two project dirs is counted once (global dedup)", () => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-cost-"));
	try {
		const encA = "-Users-me-repoA";
		const encB = "-Users-me-repoB";
		mkdirSync(join(root, encA));
		mkdirSync(join(root, encB));
		// The SAME usage-bearing line (id "DUP", requestId "R") replayed into two different project dirs:
		// Claude Code duplicates lines across resumed/forked sessions. Global dedup must count it once.
		writeFileSync(join(root, encA, "s1.jsonl"), `${LINE("s1", "DUP", "R", 100)}\n`);
		writeFileSync(join(root, encB, "s2.jsonl"), `${LINE("s2", "DUP", "R", 100)}\n`);
		const cache: CostCache = {
			files: {},
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), inputPrice, decodedResolver);
		const total = Object.values(scan.aggregate.tokenPriced).reduce((a, b) => a + b, 0);
		expect(total).toBe(100); // counted once across the tree, not 200
		// Earliest-then-stable order attributes the single survivor to s1 (repoA sorts first).
		expect(scan.aggregate.tokenPriced["s1"]).toBe(100);
		expect(scan.aggregate.tokenPriced["s2"]).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: carries forward the authoritative chat map across ticks", () => {
	const { root } = projectsTree();
	try {
		const cache: CostCache = {
			files: {},
			aggregate: { chat: { s1: 99.5 }, tokenPriced: {}, sessionProject: {}, byModel: {} },
			lastScanTs: 0,
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), inputPrice, decodedResolver);
		expect(scan.aggregate.chat["s1"]).toBe(99.5); // authoritative, not rebuilt from files
		expect(scan.aggregate.tokenPriced["s1"]).toBe(50); // token-priced lives separately
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: unchanged file reuses cache (price not called); changed file re-priced", () => {
	const { root, encA } = projectsTree();
	try {
		// Seed the cache with file A's current stat, so an unchanged A is reused.
		const pathA = join(root, encA, "s1.jsonl");
		const stA = statSync(pathA);
		let calls = 0;
		const spy: PriceFn = (u: Usage) => {
			calls += 1;
			return u.input_tokens;
		};
		const seeded: CostCache = {
			lastScanTs: 0,
			aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
			files: {
				[pathA]: {
					mtime: stA.mtimeMs,
					size: stA.size,
					total: 999, // sentinel: proves the cached entry is reused verbatim
					lines: [{ id: "M", reqId: "Q", sidechain: false, ts: 1, cost: 999 }],
					models: [],
					projectPath: "/Users/me/repoA",
					record: {
						session: asSession("s1"),
						project: asProject("/Users/me/repoA"),
						start: 0,
						end: 0,
						tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
						messages: 0,
					},
				},
			},
		};
		const scan = scanCostTree(root, seeded, fixedClock(COST_NOW), spy, decodedResolver);
		const entryA = scan.files[pathA];
		expect(entryA?.total).toBe(999); // reused, not re-priced
		expect(scan.aggregate.tokenPriced["s1"]).toBe(999);
		// price was called only for the changed/new file B (one deduped line), never for cached A.
		expect(calls).toBe(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanCostTree: TTL gate skips the walk and returns the cached aggregate", () => {
	const { root, encA } = projectsTree();
	try {
		const pathA = join(root, encA, "s1.jsonl");
		let calls = 0;
		const spy: PriceFn = (u: Usage) => {
			calls += 1;
			return u.input_tokens;
		};
		const cache: CostCache = {
			lastScanTs: COST_NOW, // now - lastScanTs = 0 <= COST_TTL_MS ⇒ fresh
			// The real persist path always writes an aggregate consistent with `files`, so within TTL the cached
			// aggregate is returned as-is (no rebuild) and the walk/pricing is skipped.
			aggregate: {
				chat: {},
				tokenPriced: { s1: 5 },
				sessionProject: { s1: "/proj" },
				byModel: {},
			},
			files: {
				[pathA]: {
					mtime: 1,
					size: 1,
					total: 5,
					lines: [{ id: "M", reqId: "Q", sidechain: false, ts: 1, cost: 5 }],
					models: [],
					projectPath: "/proj",
					record: {
						session: asSession("s1"),
						project: asProject("proj"),
						start: 0,
						end: 0,
						tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
						messages: 0,
					},
				},
			},
		};
		const scan = scanCostTree(root, cache, fixedClock(COST_NOW), spy, decodedResolver);
		expect(calls).toBe(0); // walk skipped
		expect(scan.lastScanTs).toBe(COST_NOW);
		expect(scan.aggregate.tokenPriced["s1"]).toBe(5);
		expect(scan.files).toBe(cache.files);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
