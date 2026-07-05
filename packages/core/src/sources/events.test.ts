import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { MOOD_WINDOW_MS, EVENT_LOG_MAX, type Event } from "../domain";

import { fixedClock } from "./clock";
import { appendEvent, readEvents } from "./events";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-ev-"));
}

test("append three events, read them back; a malformed line is skipped", () => {
	const dir = tmp();
	try {
		const now = 1_000_000;
		const clock = fixedClock(now);
		appendEvent(dir, { ts: now, category: "test_fail", stack: "python" });
		appendEvent(dir, { ts: now, category: "build_pass" });
		appendEvent(dir, { ts: now, category: "git_commit" });
		appendFileSync(join(dir, "events.jsonl"), "this is not json\n");
		const events = readEvents(dir, clock);
		expect(events.map((e) => e.category)).toEqual(["test_fail", "build_pass", "git_commit"]);
		expect(events[0]?.stack).toBe("python");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("missing directory reads as an empty list, never throws", () => {
	const dir = join(tmp(), "does-not-exist");
	expect(readEvents(dir, fixedClock(1))).toEqual([]);
});

test("events older than MOOD_WINDOW_MS are dropped on read", () => {
	const dir = tmp();
	try {
		const now = 10 * MOOD_WINDOW_MS;
		appendEvent(dir, { ts: now - MOOD_WINDOW_MS - 1, category: "test_fail" }); // stale
		appendEvent(dir, { ts: now - 5, category: "build_pass" }); // fresh
		const events = readEvents(dir, fixedClock(now));
		expect(events.map((e) => e.category)).toEqual(["build_pass"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("entries with an unknown category or bad ts are dropped", () => {
	const dir = tmp();
	try {
		const f = join(dir, "events.jsonl");
		appendEvent(dir, { ts: 1, category: "test_pass" });
		appendFileSync(f, `${JSON.stringify({ ts: 1, category: "nonsense" })}\n`);
		appendFileSync(f, `${JSON.stringify({ ts: "soon", category: "test_pass" })}\n`);
		appendFileSync(f, `${JSON.stringify(["array", "not", "object"])}\n`);
		const events = readEvents(dir, fixedClock(1));
		expect(events).toEqual([{ ts: 1, category: "test_pass" }] as Event[]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("append stays bounded at EVENT_LOG_MAX", () => {
	const dir = tmp();
	try {
		for (let i = 0; i < EVENT_LOG_MAX + 25; i++) {
			appendEvent(dir, { ts: 1, category: "file_edit" });
		}
		const lines = readFileSync(join(dir, "events.jsonl"), "utf8")
			.split("\n")
			.filter((l) => l.length > 0);
		expect(lines.length).toBe(EVENT_LOG_MAX);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
