/** The Claude Code statusline stdin JSON, narrowed from `unknown`. */
export interface Payload {
	readonly session_id?: string;
	readonly session_name?: string; // best-effort: absent from the official available-data table
	readonly version?: string; // CLI version, used for the oauthUsage User-Agent
	readonly transcript_path?: string;
	readonly cwd?: string; // fall back here when workspace.current_dir is absent
	readonly workspace: {
		readonly current_dir?: string;
		readonly repo?: { readonly host?: string; readonly owner?: string; readonly name?: string };
		readonly added_dirs?: readonly string[];
		readonly git_worktree?: string;
	};
	readonly worktree?: {
		readonly name?: string;
		readonly path?: string;
		readonly branch?: string;
		readonly original_cwd?: string;
		readonly original_branch?: string;
	};
	readonly model: { readonly id?: string; readonly display_name?: string };
	readonly output_style?: { readonly name?: string };
	readonly thinking?: { readonly enabled?: boolean };
	readonly effort?: { readonly level?: string };
	readonly agent?: { readonly name?: string }; // best-effort: absent from the official available-data table
	readonly cost?: { readonly total_cost_usd?: number; readonly total_duration_ms?: number };
	readonly context_window?: {
		readonly used_percentage?: number;
		readonly total_input_tokens?: number;
		readonly context_window_size?: number;
	};
	readonly rate_limits?: { readonly five_hour?: Quota; readonly seven_day?: Quota };
	readonly pr?: {
		readonly number?: number;
		readonly url?: string;
		readonly review_state?: string;
	};
	// extra_usage (PAYG) is NOT here — it lives on UsageData (OAuth response).
}

/** used_percentage is 0–100; resets_at is epoch seconds (a number, not a string). */
interface Quota {
	readonly used_percentage?: number;
	readonly resets_at?: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Conditional-spread an optional key so the literal stays exactOptionalPropertyTypes-safe. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
	value !== undefined ? ({ [key]: value } as Record<K, V>) : {};

function parseStringArray(v: unknown): readonly string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	return v.filter((x): x is string => typeof x === "string");
}

function parseRepo(v: unknown): Payload["workspace"]["repo"] {
	if (v === null || typeof v !== "object") return undefined;
	const r = obj(v);
	return {
		...opt("host", str(r["host"])),
		...opt("owner", str(r["owner"])),
		...opt("name", str(r["name"])),
	};
}

function parseWorkspace(v: unknown): Payload["workspace"] {
	const r = obj(v);
	const added = parseStringArray(r["added_dirs"]);
	return {
		...opt("current_dir", str(r["current_dir"])),
		...opt("repo", parseRepo(r["repo"])),
		...opt("added_dirs", added),
		...opt("git_worktree", str(r["git_worktree"])),
	};
}

function parseWorktree(v: unknown): Payload["worktree"] {
	if (v === null || typeof v !== "object") return undefined;
	const r = obj(v);
	return {
		...opt("name", str(r["name"])),
		...opt("path", str(r["path"])),
		...opt("branch", str(r["branch"])),
		...opt("original_cwd", str(r["original_cwd"])),
		...opt("original_branch", str(r["original_branch"])),
	};
}

function parseModel(v: unknown): Payload["model"] {
	const r = obj(v);
	return { ...opt("id", str(r["id"])), ...opt("display_name", str(r["display_name"])) };
}

function parseQuota(v: unknown): Quota | undefined {
	if (v === null || typeof v !== "object") return undefined;
	const r = obj(v);
	return {
		...opt("used_percentage", num(r["used_percentage"])),
		...opt("resets_at", num(r["resets_at"])),
	};
}

function parseRateLimits(v: unknown): Payload["rate_limits"] {
	if (v === null || typeof v !== "object") return undefined;
	const r = obj(v);
	return {
		...opt("five_hour", parseQuota(r["five_hour"])),
		...opt("seven_day", parseQuota(r["seven_day"])),
	};
}

function parsePr(v: unknown): Payload["pr"] {
	if (v === null || typeof v !== "object") return undefined;
	const r = obj(v);
	return {
		...opt("number", num(r["number"])),
		...opt("url", str(r["url"])),
		...opt("review_state", str(r["review_state"])),
	};
}

/** Parse Claude Code's stdin JSON into a typed `Payload`, or `null` when it is not a usable object. */
export function parsePayload(raw: unknown): Payload | null {
	if (raw === null || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;

	const cost = obj(r["cost"]);
	const ctx = obj(r["context_window"]);

	return {
		...opt("session_id", str(r["session_id"])),
		...opt("session_name", str(r["session_name"])),
		...opt("version", str(r["version"])),
		...opt("transcript_path", str(r["transcript_path"])),
		...opt("cwd", str(r["cwd"])),
		workspace: parseWorkspace(r["workspace"]),
		...opt("worktree", parseWorktree(r["worktree"])),
		model: parseModel(r["model"]),
		...opt(
			"output_style",
			r["output_style"] !== undefined ?
				{ ...opt("name", str(obj(r["output_style"])["name"])) }
			:	undefined,
		),
		...opt(
			"thinking",
			r["thinking"] !== undefined ?
				{ ...opt("enabled", bool(obj(r["thinking"])["enabled"])) }
			:	undefined,
		),
		...opt(
			"effort",
			r["effort"] !== undefined ?
				{ ...opt("level", str(obj(r["effort"])["level"])) }
			:	undefined,
		),
		...opt(
			"agent",
			r["agent"] !== undefined ? { ...opt("name", str(obj(r["agent"])["name"])) } : undefined,
		),
		...opt(
			"cost",
			r["cost"] !== undefined ?
				{
					...opt("total_cost_usd", num(cost["total_cost_usd"])),
					...opt("total_duration_ms", num(cost["total_duration_ms"])),
				}
			:	undefined,
		),
		...opt(
			"context_window",
			r["context_window"] !== undefined ?
				{
					...opt("used_percentage", num(ctx["used_percentage"])),
					...opt("total_input_tokens", num(ctx["total_input_tokens"])),
					...opt("context_window_size", num(ctx["context_window_size"])),
				}
			:	undefined,
		),
		...opt("rate_limits", parseRateLimits(r["rate_limits"])),
		...opt("pr", parsePr(r["pr"])),
	};
}
