import { createHash } from "node:crypto";

import { classify } from "../derived";
import { type Clock, appendEvent, ccsidekickRoot, sessionDir } from "../sources";

/**
 * Failure-shaped output markers: a tool that reported success but whose text looks like a failure. Kept
 * tight to avoid false positives on benign summaries — a bare "Error" is excluded (it matches "0 Error(s)"),
 * counts require a non-zero leading digit ("2 failed", not "0 failed"), and the uppercase status words
 * `FAIL`/`FAILED` stay case-sensitive (go/jest/pytest print them) while lowercase compiler markers
 * (`error:`, `error[`, `error TS…`, `error CS…`) catch cargo/clang/tsc/dotnet. Only the test/build/typecheck
 * families read the resulting `ok`; every other category ignores it.
 */
const FAIL_RE =
	/\bFAILED\b|\bFAIL\b|✗|✕|\bnot ok\b|error:|error\[|error TS\d|error CS\d|\bpanic:|Traceback \(most recent call last\)|[1-9]\d* (?:failed|failing|errors?)\b/;

function asObject(v: unknown): Record<string, unknown> | undefined {
	return typeof v === "object" && v !== null && !Array.isArray(v) ?
			(v as Record<string, unknown>)
		:	undefined;
}

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

/**
 * The soft-fail heuristic for a `PostToolUse` success: flip to a failure when (whichever fields are present)
 * `isError`, `interrupted`, or the combined `stdout`+`stderr` matches `FAIL_RE`. A non-empty `stderr` is NOT
 * itself a fail signal — many toolchains (cargo/rustc, node, pip) write progress and warnings to stderr on
 * success — so failure must be evidenced by a `FAIL_RE` marker. A `tool_response` may arrive as the
 * structured object or as a serialized string.
 */
function softFail(toolResponse: unknown): boolean {
	const text = asString(toolResponse);
	if (text !== undefined) return FAIL_RE.test(text);
	const r = asObject(toolResponse);
	if (r === undefined) return false;
	if (r["isError"] === true || r["interrupted"] === true) return true;
	// Join the two streams with a newline so a marker at the end of stdout keeps its word boundary against
	// the start of stderr (a bare concatenation could fuse "…failed" + "FAILED…" into one token).
	const out = `${asString(r["stdout"]) ?? ""}\n${asString(r["stderr"]) ?? ""}`;
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

/**
 * Read one hook payload, branch on `hook_event_name` to set the call's success, classify, and append one
 * `Event` to the session log. Never throws: a malformed payload or a disk/append failure is swallowed (no
 * event, no output). Disk only — no API, no tokens. Only the per-call `PostToolUse`/`PostToolUseFailure`
 * hooks are handled; `PostToolBatch` co-fires with them (double-counting every call), so it is deliberately
 * not wired and its payload — which carries no top-level `tool_name` — falls through to a no-op.
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
