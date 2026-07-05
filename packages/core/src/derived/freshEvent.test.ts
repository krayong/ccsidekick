import { expect, test } from "bun:test";

import type { Event } from "../domain";

import { freshestEvent } from "./freshEvent";

const ev = (ts: number, category: Event["category"]): Event => ({ ts, category });

test("freshestEvent returns null for no events", () => {
	expect(freshestEvent([])).toBeNull();
});

test("freshestEvent takes the greatest timestamp", () => {
	const events = [ev(10, "git_commit"), ev(30, "file_edit"), ev(20, "test_pass")];
	expect(freshestEvent(events)?.ts).toBe(30);
});

test("a later event wins even when its category outranks an earlier one", () => {
	// git_commit at a later ts beats an earlier test_fail despite failures outranking git.
	const events = [ev(10, "test_fail"), ev(20, "git_commit")];
	expect(freshestEvent(events)?.category).toBe("git_commit");
});

test("equal timestamps break by category: failures before wins before git before file ops before meta", () => {
	expect(freshestEvent([ev(5, "git_commit"), ev(5, "test_fail")])?.category).toBe("test_fail");
	expect(freshestEvent([ev(5, "test_pass"), ev(5, "test_fail")])?.category).toBe("test_fail");
	expect(freshestEvent([ev(5, "git_commit"), ev(5, "build_pass")])?.category).toBe("build_pass");
	expect(freshestEvent([ev(5, "file_edit"), ev(5, "git_push")])?.category).toBe("git_push");
	expect(freshestEvent([ev(5, "todo_update"), ev(5, "file_read")])?.category).toBe("file_read");
});
