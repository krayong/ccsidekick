import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { runClassify } from "../../src/cli";
import { fixedClock } from "../../src/sources";

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}

const BIN = join(import.meta.dir, "../../src/bin/ccsidekick-render.ts");

function tmp(): string {
	return track(mkdtempSync(join(tmpdir(), "cc-")));
}

test("PostToolUse success appends a git_push event", () => {
	const root = tmp();
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "git push" },
		tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false },
		session_id: "s1",
		cwd: "/r",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1000));
	const log = readFileSync(join(root, "ccsidekick/sessions/s1/events.jsonl"), "utf8");
	expect(log).toContain("git_push");
});

test("PostToolUseFailure is authoritative: a failing pytest is test_fail (ok=false)", () => {
	const root = tmp();
	// failure payload carries `error`, no tool_response; hook_event_name forces ok=false
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUseFailure",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		error: "Command exited with code 1",
		session_id: "s3",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s3/events.jsonl"), "utf8")).toContain(
		"test_fail",
	);
});

test("PostToolUse soft-fail: a pytest whose output matches the failure pattern is test_fail", () => {
	const root = tmp();
	// hook fired on success, but the output text trips the soft-fail heuristic ⇒ ok=false
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		tool_response: {
			stdout: "1 failed",
			stderr: "FAILED tests/test_x.py",
			interrupted: false,
			isImage: false,
		},
		session_id: "s4",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s4/events.jsonl"), "utf8")).toContain(
		"test_fail",
	);
});

test("PostToolUse soft-fail: a non-empty stderr alone flips a passing-looking test to test_fail", () => {
	const root = tmp();
	// Bash tool_response carries NO exit code; a standalone non-empty stderr (even without a FAIL_RE
	// match in the text) is itself the fail signal ⇒ ok=false.
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		tool_response: { stdout: "ran", stderr: "warning: slow run", interrupted: false },
		session_id: "s6",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s6/events.jsonl"), "utf8")).toContain(
		"test_fail",
	);
});

test("PostToolUse soft-fail: isError flips a passing-looking test to test_fail", () => {
	const root = tmp();
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		tool_response: { stdout: "ran", stderr: "", isError: true, interrupted: false },
		session_id: "s6e",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s6e/events.jsonl"), "utf8")).toContain(
		"test_fail",
	);
});

test("PostToolUse soft-fail: interrupted flips a passing-looking test to test_fail", () => {
	const root = tmp();
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		tool_response: { stdout: "ran", stderr: "", interrupted: true },
		session_id: "s6i",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s6i/events.jsonl"), "utf8")).toContain(
		"test_fail",
	);
});

test("PostToolUse pass: a clean pytest is test_pass", () => {
	const root = tmp();
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		tool_response: { stdout: "2 passed", stderr: "", interrupted: false, isImage: false },
		session_id: "s7",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s7/events.jsonl"), "utf8")).toContain(
		"test_pass",
	);
});

test("PostToolBatch iterates tool_calls[] and appends one event per matching call", () => {
	const root = tmp();
	// a batch of two matching Bash calls ⇒ two events; tool_response carries no exit_code
	const stdin = JSON.stringify({
		hook_event_name: "PostToolBatch",
		session_id: "s5",
		cwd: "/r",
		tool_calls: [
			{
				tool_name: "Bash",
				tool_input: { command: "git push" },
				tool_use_id: "t1",
				tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false },
			},
			{
				tool_name: "Bash",
				tool_input: { command: "git commit -m x" },
				tool_use_id: "t2",
				tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false },
			},
		],
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	const lines = readFileSync(join(root, "ccsidekick/sessions/s5/events.jsonl"), "utf8")
		.trim()
		.split("\n");
	expect(lines.length).toBe(2);
});

test("PostToolBatch with no tool_calls array writes nothing", () => {
	const root = tmp();
	runClassify(
		JSON.stringify({ hook_event_name: "PostToolBatch", session_id: "sb" }),
		{ CLAUDE_CONFIG_DIR: root },
		fixedClock(1),
	);
	expect(existsSync(join(root, "ccsidekick/sessions/sb/events.jsonl"))).toBe(false);
});

test("unmatched command writes nothing", () => {
	const root = tmp();
	runClassify(
		JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "echo hi" },
			session_id: "s2",
		}),
		{ CLAUDE_CONFIG_DIR: root },
		fixedClock(1),
	);
	expect(existsSync(join(root, "ccsidekick/sessions/s2/events.jsonl"))).toBe(false);
});

test("a default (id-less) payload is never recorded", () => {
	const root = tmp();
	runClassify(
		JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "git push" },
		}),
		{ CLAUDE_CONFIG_DIR: root },
		fixedClock(1),
	);
	expect(existsSync(join(root, "ccsidekick/sessions"))).toBe(false);
});

test("malformed stdin never throws and writes nothing", () => {
	const root = tmp();
	expect(() => {
		runClassify("this is not json", { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	}).not.toThrow();
	expect(existsSync(join(root, "ccsidekick/sessions"))).toBe(false);
});

test("bin: malformed stdin exits 0 with empty stdout and empty stderr", () => {
	const root = tmp();
	const r = spawnSync(process.execPath, [BIN, "classify"], {
		input: "}{ not json",
		env: { ...process.env, CLAUDE_CONFIG_DIR: root },
		encoding: "utf8",
	});
	expect(r.status).toBe(0);
	expect(r.stdout).toBe("");
	expect(r.stderr).toBe("");
});

test("bin: a write failure exits 0 with empty stdout and empty stderr", () => {
	// CLAUDE_CONFIG_DIR points at a regular FILE, so mkdir of the session dir fails (ENOTDIR).
	const file = join(tmp(), "not-a-dir");
	writeFileSync(file, "x");
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "git push" },
		session_id: "s1",
	});
	const r = spawnSync(process.execPath, [BIN, "classify"], {
		input: stdin,
		env: { ...process.env, CLAUDE_CONFIG_DIR: file },
		encoding: "utf8",
	});
	expect(r.status).toBe(0);
	expect(r.stdout).toBe("");
	expect(r.stderr).toBe("");
});
