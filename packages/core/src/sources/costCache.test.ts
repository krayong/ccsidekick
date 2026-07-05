import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { asProject, asSession } from "../domain";

import { type CostCache, readCostCache, writeCostCache } from "./costCache";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-cc-"));
}

const EMPTY: CostCache = {
	files: {},
	aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
	lastScanTs: 0,
};

const SAMPLE: CostCache = {
	files: {
		"/p/sess-abc.jsonl": {
			mtime: 1719490000000,
			size: 84213,
			total: 1.27,
			lines: [
				{
					id: "msg-1",
					reqId: "req-1",
					sidechain: false,
					ts: 1719485000000,
					cost: 1.27,
					m: 0,
					tok: 101400,
				},
			],
			models: ["claude-opus-4-8"],
			projectPath: "/home/me/repo",
			record: {
				session: asSession("sess-abc123"),
				project: asProject("owner/repo"),
				start: 1719480000000,
				end: 1719490000000,
				tokens: { input: 12000, output: 3400, cache_read: 81000, cache_creation: 5000 },
				messages: 12,
			},
		},
	},
	aggregate: {
		chat: { "sess-abc123": 0.42 },
		tokenPriced: { "sess-abc123": 1.27 },
		sessionProject: { "sess-abc123": "/home/me/repo" },
		byModel: { "claude-opus-4-8": { cost: 1.27, tokens: 101400 } },
	},
	lastScanTs: 1719490000001,
};

test("write a cache with one file entry + keyed aggregate, read it back", () => {
	const root = tmp();
	try {
		writeCostCache(root, SAMPLE);
		expect(readCostCache(root)).toEqual(SAMPLE);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing cache reads as the cold (empty) default", () => {
	const root = tmp();
	try {
		expect(readCostCache(root)).toEqual(EMPTY);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("corrupt cache reads as the empty default, never throws", () => {
	const root = tmp();
	try {
		mkdirSync(join(root, "cache"), { recursive: true });
		writeFileSync(join(root, "cache", "cost.json"), "{ broken");
		expect(readCostCache(root)).toEqual(EMPTY);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("valid JSON of the wrong shape coerces to empty, off-shape entries dropped", () => {
	const root = tmp();
	try {
		mkdirSync(join(root, "cache"), { recursive: true });
		writeFileSync(
			join(root, "cache", "cost.json"),
			JSON.stringify({
				files: {
					good: SAMPLE.files["/p/sess-abc.jsonl"],
					bad: { mtime: 1, size: 2 }, // missing total/lines/record -> dropped
				},
				aggregate: {
					chat: { s: 1, junk: "x" },
					tokenPriced: "nope",
					sessionProject: { a: "/p", bad: 7 },
				},
				lastScanTs: "soon",
			}),
		);
		expect(readCostCache(root)).toEqual({
			files: { good: SAMPLE.files["/p/sess-abc.jsonl"] as CostCache["files"][string] },
			aggregate: {
				chat: { s: 1 },
				tokenPriced: {},
				sessionProject: { a: "/p" },
				byModel: {},
			},
			lastScanTs: 0,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concurrent read while the lock is held uses the read-only path", () => {
	const root = tmp();
	try {
		writeCostCache(root, SAMPLE);
		const lockPath = join(root, "cache", "cost.json.lock");
		const fd = openSync(lockPath, "wx"); // hold the lock as another writer would
		try {
			expect(readCostCache(root)).toEqual(SAMPLE); // read-only fallback still returns data
		} finally {
			rmSync(lockPath, { force: true });
		}
		void fd;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a write skipped under a held lock leaves the prior value intact", () => {
	const root = tmp();
	try {
		writeCostCache(root, SAMPLE);
		const lockPath = join(root, "cache", "cost.json.lock");
		openSync(lockPath, "wx");
		try {
			writeCostCache(root, EMPTY); // lock held -> skipped, no throw
			rmSync(lockPath, { force: true });
			expect(readCostCache(root)).toEqual(SAMPLE);
		} finally {
			rmSync(lockPath, { force: true });
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
