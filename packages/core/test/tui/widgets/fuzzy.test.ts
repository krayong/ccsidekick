import { expect, test } from "bun:test";

import { fuzzyFilter, fuzzyScore } from "../../../src/tui/widgets";

const id = (s: string): string => s;

test("fuzzyScore matches a case-insensitive subsequence and rejects a non-subsequence", () => {
	expect(fuzzyScore("git", "git_branch")).not.toBeNull();
	expect(fuzzyScore("GIT", "git_branch")).not.toBeNull();
	expect(fuzzyScore("the", "Theme")).not.toBeNull();
	expect(fuzzyScore("the", "Tips")).toBeNull(); // no 'h' after the 't'
	expect(fuzzyScore("the", "Character")).toBeNull(); // 'h' precedes 't', not a subsequence
});

test("fuzzyScore rewards a contiguous prefix over a scattered match", () => {
	const prefix = fuzzyScore("git", "git_branch");
	const scattered = fuzzyScore("git", "gooey_input_tail");
	expect(prefix).not.toBeNull();
	expect(scattered).not.toBeNull();
	expect(prefix as number).toBeGreaterThan(scattered as number);
});

test("fuzzyFilter keeps matches, ranks by score, and passes everything through on an empty query", () => {
	const items = ["currency", "budget", "git_branch", "git_status"] as const;
	expect(fuzzyFilter("git", items, id)).toEqual(["git_branch", "git_status"]);
	expect(fuzzyFilter("the", ["Character", "Theme", "Tips"], id)).toEqual(["Theme"]);
	expect(fuzzyFilter("", items, id)).toEqual(["currency", "budget", "git_branch", "git_status"]);
});

test("fuzzyFilter breaks score ties by original order (stable, deterministic)", () => {
	// Both contain "ab" contiguously at index 0, so they tie on score; input order wins.
	expect(fuzzyFilter("ab", ["abx", "aby"], (s) => s)).toEqual(["abx", "aby"]);
});
