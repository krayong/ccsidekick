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

test("PostToolUse soft-fail: a benign stderr warning no longer flips a passing test (CF2)", () => {
	const root = tmp();
	// Many toolchains (cargo/rustc, node, pip) write progress/warnings to stderr even on success. A non-empty
	// stderr alone must NOT flag a failure — only failure-shaped output (FAIL_RE) or isError/interrupted does.
	const stdin = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command: "pytest" },
		tool_response: { stdout: "5 passed", stderr: "warning: slow run", interrupted: false },
		session_id: "s6",
	});
	runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
	expect(readFileSync(join(root, "ccsidekick/sessions/s6/events.jsonl"), "utf8")).toContain(
		"test_pass",
	);
});

test("soft-fail fixture corpus: real success/failure output across ecosystems is classified correctly", () => {
	// Each row: a recognized build/test command + a real-shaped tool_response, and whether it should read as
	// a failure. Success rows that write to stderr (cargo) or print a "0 Error(s)" summary (dotnet) must NOT
	// flip; failure rows with ecosystem-specific markers must.
	const cases: ReadonlyArray<{
		cmd: string;
		stdout: string;
		stderr: string;
		fail: boolean;
	}> = [
		// ── successes ──
		{
			cmd: "cargo build",
			stdout: "",
			stderr: "   Compiling foo v0.1.0\n    Finished",
			fail: false,
		},
		{
			cmd: "cargo test",
			stdout: "test result: ok. 5 passed; 0 failed",
			stderr: "Compiling foo",
			fail: false,
		},
		{
			cmd: "npm test",
			stdout: "Tests: 5 passed, 5 total\nPASS src/x.test.js",
			stderr: "",
			fail: false,
		},
		{ cmd: "go test ./...", stdout: "ok  \tpkg\t0.1s\nPASS", stderr: "", fail: false },
		{ cmd: "pytest", stdout: "===== 5 passed in 0.10s =====", stderr: "", fail: false },
		{
			cmd: "dotnet build",
			stdout: "Build succeeded.\n    0 Warning(s)\n    0 Error(s)",
			stderr: "",
			fail: false,
		},
		// ── failures ──
		{ cmd: "cargo build", stdout: "", stderr: "error[E0308]: mismatched types", fail: true },
		{
			cmd: "cargo test",
			stdout: "test result: FAILED. 3 passed; 2 failed",
			stderr: "",
			fail: true,
		},
		{
			cmd: "npm test",
			stdout: "Tests: 2 failed, 3 passed\nFAIL src/x.test.js",
			stderr: "",
			fail: true,
		},
		{
			cmd: "go test ./...",
			stdout: "--- FAIL: TestFoo\nFAIL\tpkg\t0.1s",
			stderr: "",
			fail: true,
		},
		{
			cmd: "pytest",
			stdout: "===== 2 failed, 3 passed in 0.10s =====",
			stderr: "",
			fail: true,
		},
		{
			cmd: "dotnet build",
			stdout: "src/x.cs(1,1): error CS1002: ; expected",
			stderr: "",
			fail: true,
		},
	];
	cases.forEach((c, i) => {
		const root = tmp();
		const stdin = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: c.cmd },
			tool_response: { stdout: c.stdout, stderr: c.stderr, interrupted: false },
			session_id: `corpus-${String(i)}`,
		});
		runClassify(stdin, { CLAUDE_CONFIG_DIR: root }, fixedClock(1));
		const log = readFileSync(
			join(root, `ccsidekick/sessions/corpus-${String(i)}/events.jsonl`),
			"utf8",
		);
		const wantSuffix = c.fail ? "_fail" : "_pass";
		expect(`${c.cmd} → ${log.trim()}`).toContain(wantSuffix);
	});
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

test("PostToolBatch is no longer classified: its payload writes nothing (double-count fix)", () => {
	// PostToolBatch co-fires with the per-call PostToolUse/PostToolUseFailure hooks, so classifying it too
	// double-counted every event. The batch hook is retired; its payload must produce no event.
	const root = tmp();
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
	expect(existsSync(join(root, "ccsidekick/sessions/s5/events.jsonl"))).toBe(false);
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
