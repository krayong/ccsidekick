import { createHash } from "node:crypto";

import { classify } from "../derived";
import { type Clock, appendEvent, ccsidekickRoot, sessionDir } from "../sources";

/**
 * Soft-fail output patterns: a tool that reported success but whose text/flags look like a failure.
 * Only the test/build/typecheck families read the resulting `ok`; every other category ignores it.
 */
const FAIL_RE = /FAILED|Error|✗|not ok|FAIL/;

function asObject(v: unknown): Record<string, unknown> | undefined {
	return typeof v === "object" && v !== null && !Array.isArray(v) ?
			(v as Record<string, unknown>)
		:	undefined;
}

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

/**
 * The soft-fail heuristic for a `PostToolUse`/batch success: flip to a failure when (whichever fields are
 * present) `isError`, a non-empty `stderr`, an output match of `FAIL_RE`, or `interrupted`. A Bash
 * `tool_response` carries no exit code, so a standalone non-empty `stderr` is itself a fail signal. A
 * `tool_response` may arrive as the structured object or as a serialized string.
 */
function softFail(toolResponse: unknown): boolean {
	const text = asString(toolResponse);
	if (text !== undefined) return FAIL_RE.test(text);
	const r = asObject(toolResponse);
	if (r === undefined) return false;
	if (r["isError"] === true || r["interrupted"] === true) return true;
	const stderr = asString(r["stderr"]);
	if (stderr !== undefined && stderr !== "") return true;
	const out = `${asString(r["stdout"]) ?? ""}${stderr ?? ""}`;
	return FAIL_RE.test(out);
}

function commandOf(toolInput: unknown): string {
	return asString(asObject(toolInput)?.["command"]) ?? "";
}

/**
 * Session identity: the payload `session_id`, else a stable sha1 of `transcript_path` (first 16 hex chars).
 * Returns `undefined` for the id-less case — the `"default"` session is never recorded.
 */
function resolveSession(r: Record<string, unknown>): string | undefined {
	const sid = asString(r["session_id"]);
	if (sid !== undefined && sid !== "") return sid;
	const path = asString(r["transcript_path"]);
	if (path !== undefined && path !== "") {
		return createHash("sha1").update(path).digest("hex").slice(0, 16);
	}
	return undefined;
}

function appendClassified(
	dir: string,
	toolName: string,
	command: string,
	ok: boolean,
	ts: number,
): void {
	const c = classify(toolName, command, ok);
	if (c !== null) appendEvent(dir, { ts, ...c });
}

/** `PostToolBatch`: classify and append one event per well-formed tool call in the batch. */
function appendBatch(dir: string, calls: readonly unknown[], ts: number): void {
	for (const call of calls) {
		const c = asObject(call);
		const toolName = c !== undefined ? asString(c["tool_name"]) : undefined;
		if (c === undefined || toolName === undefined) continue;
		const ok = !softFail(c["tool_response"]);
		appendClassified(dir, toolName, commandOf(c["tool_input"]), ok, ts);
	}
}

/**
 * Read one hook payload, branch on `hook_event_name` to set each call's success, classify, and append one
 * `Event` per matching tool call to the session log. Never throws: a malformed payload or a disk/append
 * failure is swallowed (no event, no output). Disk only — no API, no tokens.
 */
export function runClassify(stdin: string, env: NodeJS.ProcessEnv, clock: Clock): void {
	try {
		const r = asObject(JSON.parse(stdin) as unknown);
		if (r === undefined) return;
		const session = resolveSession(r);
		if (session === undefined) return;
		const dir = sessionDir(ccsidekickRoot(env), session);
		const ts = clock.now();
		const hook = asString(r["hook_event_name"]);

		if (hook === "PostToolBatch") {
			const calls = r["tool_calls"];
			if (Array.isArray(calls)) appendBatch(dir, calls as unknown[], ts);
			return;
		}

		const toolName = asString(r["tool_name"]);
		if (toolName === undefined) return;
		const command = commandOf(r["tool_input"]);
		if (hook === "PostToolUseFailure") {
			appendClassified(dir, toolName, command, false, ts);
		} else if (hook === "PostToolUse") {
			appendClassified(dir, toolName, command, !softFail(r["tool_response"]), ts);
		}
	} catch {
		/* never throw: a malformed payload or disk failure must not surface to Claude Code */
	}
}
