import { expect, test } from "bun:test";

import canonical from "../../test/fixtures/payloads/canonical.json";

import { parsePayload } from "./payload";

test("parses canonical payload; rejects non-objects", () => {
	const p = parsePayload(canonical);
	expect(p?.session_id).toBe("sess-123");
	expect(p?.model.display_name).toBe("Claude Opus 4.8");
	expect(parsePayload("nope")).toBeNull();
	expect(parsePayload(null)).toBeNull();
	expect(parsePayload({})?.session_id).toBeUndefined(); // missing optional ⇒ undefined, not crash
});

test("reads the full canonical field set", () => {
	const p = parsePayload(canonical);
	expect(p?.session_name).toBe("rewrite/payload");
	expect(p?.version).toBe("1.2.3");
	expect(p?.transcript_path).toBe("/home/dev/.claude/projects/proj/sess-123.jsonl");
	expect(p?.cwd).toBe("/home/dev/proj");
	expect(p?.workspace.current_dir).toBe("/home/dev/proj/packages/core");
	expect(p?.workspace.repo).toEqual({ host: "github.com", owner: "krayong", name: "ccsidekick" });
	expect(p?.workspace.added_dirs).toEqual(["/home/dev/proj/docs", "/home/dev/proj/scripts"]);
	expect(p?.workspace.git_worktree).toBe("/home/dev/proj");
	expect(p?.worktree?.branch).toBe("rewrite/packages");
	expect(p?.worktree?.original_branch).toBe("main");
	expect(p?.model.id).toBe("claude-opus-4-8");
	expect(p?.output_style?.name).toBe("Explanatory");
	expect(p?.thinking?.enabled).toBe(true);
	expect(p?.effort?.level).toBe("high");
	expect(p?.agent?.name).toBe("general-purpose");
	expect(p?.cost?.total_cost_usd).toBe(0.4231);
	expect(p?.cost?.total_duration_ms).toBe(184320);
	expect(p?.context_window?.used_percentage).toBe(42.5);
	expect(p?.context_window?.total_input_tokens).toBe(85000);
	expect(p?.context_window?.context_window_size).toBe(200000);
	expect(p?.rate_limits?.five_hour?.used_percentage).toBe(12.5);
	expect(p?.rate_limits?.five_hour?.resets_at).toBe(1719600000);
	expect(p?.rate_limits?.seven_day?.resets_at).toBe(1720080000);
	expect(p?.pr?.number).toBe(42);
	expect(p?.pr?.review_state).toBe("approved");
});

test("dir prefers workspace.current_dir, falls back to top-level cwd", () => {
	expect(
		parsePayload({ workspace: { current_dir: "/a" }, cwd: "/b" })?.workspace.current_dir,
	).toBe("/a");
	const fallback = parsePayload({ cwd: "/b" });
	expect(fallback?.workspace.current_dir).toBeUndefined();
	expect(fallback?.cwd).toBe("/b");
});

test("empty object yields defaulted workspace/model containers, all optionals undefined", () => {
	const p = parsePayload({});
	expect(p).not.toBeNull();
	expect(p?.workspace).toEqual({});
	expect(p?.model).toEqual({});
	expect(p?.rate_limits).toBeUndefined();
	expect(p?.pr).toBeUndefined();
});

test("wrong-typed fields drop to undefined without throwing", () => {
	const p = parsePayload({
		session_id: 123,
		cost: { total_cost_usd: "free" },
		workspace: { added_dirs: ["/keep", 5, null, "/also"], repo: "not-an-object" },
		rate_limits: { five_hour: { used_percentage: "x", resets_at: "y" } },
		thinking: { enabled: "yes" },
	});
	expect(p?.session_id).toBeUndefined();
	expect(p?.cost?.total_cost_usd).toBeUndefined();
	expect(p?.workspace.added_dirs).toEqual(["/keep", "/also"]); // per-element string filter
	expect(p?.workspace.repo).toBeUndefined();
	expect(p?.rate_limits?.five_hour?.used_percentage).toBeUndefined();
	expect(p?.rate_limits?.five_hour?.resets_at).toBeUndefined();
	expect(p?.thinking?.enabled).toBeUndefined();
});

test("added_dirs that is not an array becomes undefined", () => {
	expect(
		parsePayload({ workspace: { added_dirs: "nope" } })?.workspace.added_dirs,
	).toBeUndefined();
});
