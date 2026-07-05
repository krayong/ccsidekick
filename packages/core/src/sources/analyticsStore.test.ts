import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { readAttribution, upsertAttribution } from "./analyticsStore";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-an-"));
}

test("upsert two sessions for the same character; the store has both", () => {
	const root = tmp();
	try {
		upsertAttribution(root, "sess-1", { project: "owner/repo", character: "batman" });
		upsertAttribution(root, "sess-2", { project: "owner/repo", character: "batman" });
		expect(readAttribution(root)).toEqual({
			"sess-1": { project: "owner/repo", character: "batman" },
			"sess-2": { project: "owner/repo", character: "batman" },
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('upserting "default" is a no-op', () => {
	const root = tmp();
	try {
		upsertAttribution(root, "default", { project: "owner/repo", character: "batman" });
		expect(readAttribution(root)).toEqual({});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("upsert overwrites an existing session's record", () => {
	const root = tmp();
	try {
		upsertAttribution(root, "sess-1", { project: "a/b", character: "robin" });
		upsertAttribution(root, "sess-1", { project: "c/d", character: "batman" });
		expect(readAttribution(root)).toEqual({
			"sess-1": { project: "c/d", character: "batman" },
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing store reads as empty; corrupt store reads as empty, never throws", () => {
	const root = tmp();
	try {
		expect(readAttribution(root)).toEqual({});
		mkdirSync(join(root, "analytics"), { recursive: true });
		writeFileSync(join(root, "analytics", "store.json"), "{ not json");
		expect(readAttribution(root)).toEqual({});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("wrong-shaped entries are dropped; a non-object root reads as empty", () => {
	const root = tmp();
	try {
		mkdirSync(join(root, "analytics"), { recursive: true });
		writeFileSync(
			join(root, "analytics", "store.json"),
			JSON.stringify({
				good: { project: "a/b", character: "batman" },
				missingChar: { project: "a/b" },
				wrongType: { project: 7, character: "x" },
				notObject: "nope",
			}),
		);
		expect(readAttribution(root)).toEqual({ good: { project: "a/b", character: "batman" } });

		writeFileSync(join(root, "analytics", "store.json"), "[1,2,3]");
		expect(readAttribution(root)).toEqual({});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("upsert skipped under a held lock leaves the prior store intact", () => {
	const root = tmp();
	try {
		upsertAttribution(root, "sess-1", { project: "a/b", character: "batman" });
		const lockPath = join(root, "analytics", "store.json.lock");
		openSync(lockPath, "wx");
		try {
			upsertAttribution(root, "sess-2", { project: "c/d", character: "robin" });
			rmSync(lockPath, { force: true });
			expect(readAttribution(root)).toEqual({
				"sess-1": { project: "a/b", character: "batman" },
			});
		} finally {
			rmSync(lockPath, { force: true });
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
