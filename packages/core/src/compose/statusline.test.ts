import { expect, test } from "bun:test";

import type { ContextInfo, CostInfo, ModelInfo, ProviderInfo, QuotaInfo } from "../derived";
import type { WidgetId } from "../domain";
import { type GitState, type Payload, type TranscriptScan, DEFAULT_CONFIG } from "../sources";

import {
	composeStatusline,
	dropOrder,
	FIELD_ROW,
	isProtected,
	rowFor,
	type ComposeInputs,
} from "./statusline";

const payload: Payload = {
	workspace: { current_dir: "/home/me/ccsidekick" },
	model: { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
	context_window: {
		used_percentage: 42,
		total_input_tokens: 418_000,
		context_window_size: 1_000_000,
	},
	cost: { total_cost_usd: 1.23 },
};

const git: GitState = {
	branch: "main",
	staged: 2,
	unstaged: 1,
	untracked: [],
	conflict: 0,
	operation: "none",
	stash: 0,
	submoduleBranches: [],
	insertions: 0,
	deletions: 0,
	changedFiles: 0,
	upstream: true,
	upstreamGone: false,
};

const model: ModelInfo = {
	name: "Opus 4.8",
	contextLabel: "1M",
	effort: "high",
	fast: false,
	thinking: false,
};

const context: ContextInfo = {
	usedPct: 42,
	usedTokens: 418_000,
	windowSize: 1_000_000,
	band: "caution",
	compactions: 0,
	cacheHitPct: 0,
	compactPressure: false,
};

const cost: CostInfo = {
	chat: 1.23,
	project: 3.6,
	total: 44.1,
	costBurnPerHr: 0,
	tokenBurnPerMin: 0,
	pending: false,
};

const provider: ProviderInfo = {
	provider: "subscription",
	hasQuota: true,
	modelName: "Claude Opus 4.8",
	badge: "",
};

const quota: QuotaInfo = {};

const scan: TranscriptScan = {
	tokens: { input: 0, output: 0, cache_read: 0, cache_creation_5m: 0, cache_creation_1h: 0 },
	messages: 0,
	compactions: 0,
	todos: [],
	burn: [],
	mtime: 0,
	size: 0,
};

const base: ComposeInputs = {
	provider,
	model,
	context,
	quota,
	cost,
	git,
	payload,
	scan,
	widgets: DEFAULT_CONFIG.statusline.widgets,
	currency: { code: "USD", rate: 1 },
	homeDir: "/home/me",
};

test("emits dir + branch + model fields with icon/label/value roles", () => {
	const { fields } = composeStatusline(base);
	const dir = fields.find((f) => f.id === "dir");
	expect(dir?.segments.some((s) => s.role === "icon")).toBe(true);
	expect(dir?.segments.some((s) => s.role === "value")).toBe(true);

	const branch = fields.find((f) => f.id === "git_branch");
	expect(branch?.segments.find((s) => s.role === "value")?.text).toBe("main");

	const m = fields.find((f) => f.id === "model");
	// The name and the protected tail (context-window size + effort) are separate value segments.
	expect(m?.segments.filter((s) => s.role === "value").map((s) => s.text)).toEqual([
		"Opus 4.8",
		"(1M) ✦ high",
	]);
});

test("git_branch appends each submodule's branch after the superproject branch", () => {
	const { fields } = composeStatusline({
		...base,
		git: { ...git, submoduleBranches: [{ path: "libs/foo", ref: "a1b2c3d" }] },
	});
	const branch = fields.find((f) => f.id === "git_branch");
	expect(branch?.segments.find((s) => s.role === "value")?.text).toBe("main ✦ libs/foo@a1b2c3d");
});

test("cost_chat carries a label and a currency value", () => {
	const { fields } = composeStatusline(base);
	const chat = fields.find((f) => f.id === "cost_chat");
	expect(chat?.segments.find((s) => s.role === "label")?.text).toBe("Chat Cost:");
	expect(chat?.segments.find((s) => s.role === "value")?.text).toBe("$1.23");
});

test("respects widget toggles (the six default-off widgets are absent)", () => {
	const { fields } = composeStatusline(base);
	const off: WidgetId[] = [
		"added_dirs",
		"agent",
		"cost_burn",
		"token_burn",
		"session_duration",
		"todo",
	];
	for (const id of off) expect(fields.find((f) => f.id === id)).toBeUndefined();
});

test("fields render in the fixed row order", () => {
	const { fields } = composeStatusline(base);
	const rows = fields.map((f) => FIELD_ROW[f.id]);
	const sorted = [...rows].sort((a, b) => a - b);
	expect(rows).toEqual(sorted);
});

test("data-gated widgets are omitted when their data is absent", () => {
	const { fields } = composeStatusline(base);
	// no conflict, no operation, no detached sha, no pr, not thinking, no compactions, no balance/payg
	for (const id of [
		"git_conflict",
		"git_operation",
		"git_hash",
		"pr",
		"thinking",
		"compactions",
		"balance",
		"pay_as_you_go",
		"session_name",
	] satisfies WidgetId[]) {
		expect(fields.find((f) => f.id === id)).toBeUndefined();
	}
});

test("git_status sums staged/unstaged/untracked buckets", () => {
	const { fields } = composeStatusline(base);
	const status = fields.find((f) => f.id === "git_status");
	expect(status?.segments.find((s) => s.role === "value")?.text).toBe("(+2 !1)");
});

test("pending cost renders the ⋯ placeholder segment with no signal", () => {
	const pending: ComposeInputs = { ...base, cost: { ...cost, pending: true } };
	const { fields } = composeStatusline(pending);
	const chat = fields.find((f) => f.id === "cost_chat");
	const seg = chat?.segments.find((s) => s.role === "placeholder");
	expect(seg?.text).toBe("⋯");
	expect(seg?.signal).toBeUndefined();
});

test("provider badge is null for a subscription and the badge text otherwise", () => {
	expect(composeStatusline(base).providerBadge).toBeNull();
	const api: ComposeInputs = {
		...base,
		provider: {
			provider: "api",
			hasQuota: false,
			modelName: "Claude Opus 4.8",
			badge: "🔑 API | ",
		},
	};
	expect(composeStatusline(api).providerBadge).toEqual([{ role: "value", text: "🔑 API | " }]);
});

test("output_style is omitted for the default style and rendered for a custom one", () => {
	for (const style of ["default", ""]) {
		const ctx: ComposeInputs = { ...base, model: { ...model, outputStyle: style } };
		expect(composeStatusline(ctx).fields.find((f) => f.id === "output_style")).toBeUndefined();
	}
	const custom: ComposeInputs = { ...base, model: { ...model, outputStyle: "Explanatory" } };
	const field = composeStatusline(custom).fields.find((f) => f.id === "output_style");
	expect(field?.segments.find((s) => s.role === "value")?.text).toBe("Explanatory");
});

test("dir home-relativizes the cwd when not in a git repo", () => {
	const ctx: ComposeInputs = {
		...base,
		git: null,
		payload: { ...payload, workspace: { current_dir: "/home/me/projects/app" } },
	};
	const dir = composeStatusline(ctx).fields.find((f) => f.id === "dir");
	expect(dir?.segments.find((s) => s.role === "value")?.text).toBe("~/projects/app");
});

test("dir uses the home-relativized repo root for an in-repo sub-path", () => {
	const ctx: ComposeInputs = {
		...base,
		git: { ...git, root: "/home/me/ccsidekick" },
		payload: { ...payload, workspace: { current_dir: "/home/me/ccsidekick/packages/core" } },
	};
	const dir = composeStatusline(ctx).fields.find((f) => f.id === "dir");
	expect(dir?.segments.find((s) => s.role === "value")?.text).toBe("~/ccsidekick");
});

test("cache_hit carries the 'Cache Hit:' label; value is unsigned at/above 80% and critical below", () => {
	// cache_hit defaults off, so enable it explicitly for this test.
	const widgets = { ...DEFAULT_CONFIG.statusline.widgets, cache_hit: true };
	const high: ComposeInputs = {
		...base,
		widgets,
		scan: { ...scan, messages: 4 },
		context: { ...context, cacheHitPct: 97 },
	};
	const cacheHit = composeStatusline(high).fields.find((f) => f.id === "cache_hit");
	expect(cacheHit?.segments.find((s) => s.role === "label")?.text).toBe("Cache Hit:");
	const hv = cacheHit?.segments.find((s) => s.role === "value");
	expect(hv?.text).toBe("97%");
	expect(hv?.signal).toBeUndefined();
	expect(FIELD_ROW.cache_hit).toBe(5); // cache_hit now lives on the session/misc row

	const low: ComposeInputs = {
		...base,
		widgets,
		scan: { ...scan, messages: 4 },
		context: { ...context, cacheHitPct: 72 },
	};
	const lowValue = composeStatusline(low)
		.fields.find((f) => f.id === "cache_hit")
		?.segments.find((s) => s.role === "value");
	expect(lowValue?.signal).toBe("critical");
});

test("session_name renders the 🪧 icon and the bare name, no label", () => {
	const ctx: ComposeInputs = {
		...base,
		widgets: { ...base.widgets, session_name: true }, // session_name defaults off
		payload: { ...payload, session_name: "spike" },
	};
	const f = composeStatusline(ctx).fields.find((f) => f.id === "session_name");
	expect(f?.segments.find((s) => s.role === "icon")?.text).toBe("🪧");
	expect(f?.segments.some((s) => s.role === "label")).toBe(false);
	expect(f?.segments.find((s) => s.role === "value")?.text).toBe("spike");
});

test("pr appends review_state as a signal-colored word", () => {
	const mk = (review_state: string) =>
		composeStatusline({
			...base,
			payload: { ...payload, pr: { number: 1234, review_state } },
		}).fields.find((f) => f.id === "pr")?.segments ?? [];

	const approved = mk("approved");
	expect(
		approved
			.filter((s) => s.role === "value")
			.map((s) => s.text)
			.slice(0, 2),
	).toEqual(["PR:", "#1234"]);
	expect(approved.find((s) => s.text === "approved")?.signal).toBe("nominal");
	expect(mk("changes_requested").find((s) => s.text === "changes_requested")?.signal).toBe(
		"critical",
	);
	expect(mk("review_required").find((s) => s.text === "review_required")?.signal).toBe(
		"critical",
	);
	expect(mk("commented").find((s) => s.text === "commented")?.signal).toBe("caution");
	// an unknown state passes through unsigned
	expect(mk("queued").find((s) => s.text === "queued")?.signal).toBeUndefined();

	// no review_state ⇒ number only
	const bare = composeStatusline({
		...base,
		payload: { ...payload, pr: { number: 7 } },
	}).fields.find((f) => f.id === "pr");
	expect(bare?.segments.filter((s) => s.role === "value").map((s) => s.text)).toEqual([
		"PR:",
		"#7",
	]);
});

test("only the #n segment carries the href; pr.url absent ⇒ no href", () => {
	const withUrl = composeStatusline({
		...base,
		payload: { ...payload, pr: { number: 7, url: "https://example.test/pull/7" } },
	}).fields.find((f) => f.id === "pr");
	expect(withUrl?.segments.find((s) => s.text === "#7")?.href).toBe(
		"https://example.test/pull/7",
	);
	// the `PR:` lead-in is never linked
	expect(withUrl?.segments.find((s) => s.text === "PR:")?.href).toBeUndefined();

	const noUrl = composeStatusline({
		...base,
		payload: { ...payload, pr: { number: 7 } },
	}).fields.find((f) => f.id === "pr");
	expect(noUrl?.segments.find((s) => s.text === "#7")?.href).toBeUndefined();
});

test("git_changes renders +insertions -deletions N files and is omitted when clean", () => {
	const dirty: ComposeInputs = {
		...base,
		git: { ...git, insertions: 12, deletions: 5, changedFiles: 3 },
	};
	const changes = composeStatusline(dirty).fields.find((f) => f.id === "git_changes");
	expect(
		changes?.segments
			.filter((s) => s.role === "value")
			.map((s) => s.text)
			.join(" "),
	).toBe("+12 -5 3 files");

	const one: ComposeInputs = {
		...base,
		git: { ...git, insertions: 4, deletions: 0, changedFiles: 1 },
	};
	const oneChanges = composeStatusline(one).fields.find((f) => f.id === "git_changes");
	expect(
		oneChanges?.segments
			.filter((s) => s.role === "value")
			.map((s) => s.text)
			.join(" "),
	).toBe("+4 1 file");

	const clean: ComposeInputs = {
		...base,
		git: { ...git, insertions: 0, deletions: 0, changedFiles: 0 },
	};
	expect(composeStatusline(clean).fields.find((f) => f.id === "git_changes")).toBeUndefined();
});

test("git_changes signs each value: adds nominal, deletes critical, files caution", () => {
	const dirty: ComposeInputs = {
		...base,
		git: { ...git, insertions: 12, deletions: 5, changedFiles: 3 },
	};
	const segs =
		composeStatusline(dirty).fields.find((f) => f.id === "git_changes")?.segments ?? [];
	expect(segs.find((s) => s.text === "+12")?.signal).toBe("nominal");
	expect(segs.find((s) => s.text === "-5")?.signal).toBe("critical");
	expect(segs.find((s) => s.text === "3 files")?.signal).toBe("caution");
});

test("git_ahead_behind drops the icon and signs each arrow: ahead nominal, behind critical", () => {
	const ab: ComposeInputs = { ...base, git: { ...git, ahead: 2, behind: 1 } };
	const f = composeStatusline(ab).fields.find((f) => f.id === "git_ahead_behind");
	expect(f?.segments.some((s) => s.role === "icon")).toBe(false);
	expect(f?.segments.find((s) => s.text === "↑2")?.signal).toBe("nominal");
	expect(f?.segments.find((s) => s.text === "↓1")?.signal).toBe("critical");
});

test("git_operation colors the op value caution", () => {
	const reb: ComposeInputs = { ...base, git: { ...git, operation: "rebase" } };
	const f = composeStatusline(reb).fields.find((f) => f.id === "git_operation");
	expect(f?.segments.find((s) => s.role === "value")?.signal).toBe("caution");
});

test("an active operation folds the conflict in: op caution, ✦ separator, conflict critical", () => {
	const reb: ComposeInputs = {
		...base,
		git: { ...git, operation: "rebase", conflict: 2 },
	};
	const { fields } = composeStatusline(reb);
	// conflict does not render as its own field
	expect(fields.find((f) => f.id === "git_conflict")).toBeUndefined();
	const op = fields.find((f) => f.id === "git_operation");
	const segs = op?.segments ?? [];
	expect(segs.map((s) => s.text).join(" ")).toBe("🌀 rebase ✦ ⚠️ 2");
	// the operation (icon + label) reads caution
	expect(segs.find((s) => s.text === "🌀")?.signal).toBe("caution");
	expect(segs.find((s) => s.text === "rebase")?.signal).toBe("caution");
	// the ✦ is a separator-role segment (rendered in the separator color), carrying no signal
	const sep = segs.find((s) => s.text === "✦");
	expect(sep?.role).toBe("separator");
	expect(sep?.signal).toBeUndefined();
	// the folded conflict (icon + count) reads critical
	expect(segs.find((s) => s.text === "⚠️")?.signal).toBe("critical");
	expect(segs.find((s) => s.text === "2")?.signal).toBe("critical");
});

test("a conflict with no operation renders standalone, critical on both icon and count", () => {
	const conf: ComposeInputs = { ...base, git: { ...git, conflict: 3, operation: "none" } };
	const { fields } = composeStatusline(conf);
	expect(fields.find((f) => f.id === "git_operation")).toBeUndefined();
	const c = fields.find((f) => f.id === "git_conflict");
	expect(c?.segments.find((s) => s.role === "icon")?.signal).toBe("critical");
	expect(c?.segments.find((s) => s.role === "value")?.signal).toBe("critical");
	expect(c?.segments.find((s) => s.role === "value")?.text).toBe("3");
});

test("pay_as_you_go groups the USD pair then the local pair; whole amounts drop decimals; paints only when elevated", () => {
	// A non-USD line currency shows the local pair; INR rate 1 keeps the numbers legible (₹ == $ amount, ceiled).
	const inr = { code: "INR", rate: 1 } as const;
	const withCap: ComposeInputs = {
		...base,
		currency: inr,
		quota: { payg: { usedCredits: 0, monthlyLimit: 100, band: "nominal" } },
	};
	const capped = composeStatusline(withCap).fields.find((f) => f.id === "pay_as_you_go");
	// Whole amounts drop the `.00`; the USD pair leads, the local pair follows.
	const cappedVal = capped?.segments.find((s) => s.role === "value");
	expect(cappedVal?.text).toBe("$0/$100 (₹0/₹100)");
	// A nominal (below-threshold) band paints nothing — no green.
	expect(cappedVal?.signal).toBeUndefined();

	const cents: ComposeInputs = {
		...base,
		currency: inr,
		quota: { payg: { usedCredits: 12.5, monthlyLimit: 50, band: "caution" } },
	};
	const centsVal = composeStatusline(cents)
		.fields.find((f) => f.id === "pay_as_you_go")
		?.segments.find((s) => s.role === "value");
	// Real cents survive; the whole cap stays bare; the local pair ceils; an elevated band paints.
	expect(centsVal?.text).toBe("$12.50/$50 (₹13/₹50)");
	expect(centsVal?.signal).toBe("caution");

	const noCap: ComposeInputs = {
		...base,
		currency: inr,
		quota: { payg: { usedCredits: 12.5, monthlyLimit: 0, band: "nominal" } },
	};
	const uncapped = composeStatusline(noCap).fields.find((f) => f.id === "pay_as_you_go");
	const v = uncapped?.segments.find((s) => s.role === "value");
	expect(v?.text).toBe("$12.50 (₹13) / ∞");
	expect(v?.signal).toBeUndefined();
});

test("USD line currency suppresses the redundant local parenthetical (M5): cost_burn, balance, pay_as_you_go", () => {
	// [statusline].currency = USD ⇒ the local conversion equals the USD figure, so the `($…)` duplicate must be dropped.
	const usd: ComposeInputs = {
		...base,
		currency: { code: "USD", rate: 1 },
		cost: { ...cost, costBurnPerHr: 0.5 },
		quota: {
			balance: { label: "$10.00", usd: 10, band: "nominal" },
			payg: { usedCredits: 12.5, monthlyLimit: 50, band: "caution" },
		},
		widgets: { ...base.widgets, cost_burn: true }, // cost_burn defaults off
	};
	const { fields } = composeStatusline(usd);
	const value = (id: WidgetId) =>
		fields.find((f) => f.id === id)?.segments.find((s) => s.role === "value")?.text;
	expect(value("cost_burn")).toBe("$0.50/h");
	expect(value("balance")).toBe("$10.00");
	expect(value("pay_as_you_go")).toBe("$12.50/$50");
	for (const id of ["cost_burn", "balance", "pay_as_you_go"] satisfies WidgetId[]) {
		expect(value(id)).not.toContain("(");
	}
});

test("a non-USD line currency keeps the local parenthetical on cost_burn and balance", () => {
	const inr: ComposeInputs = {
		...base,
		currency: { code: "INR", rate: 95 },
		cost: { ...cost, costBurnPerHr: 1 },
		quota: { balance: { label: "$10.00", usd: 10, band: "nominal" } },
		widgets: { ...base.widgets, cost_burn: true },
	};
	const { fields } = composeStatusline(inr);
	const value = (id: WidgetId) =>
		fields.find((f) => f.id === id)?.segments.find((s) => s.role === "value")?.text;
	expect(value("cost_burn")).toBe("$1.00/h (₹95/h)");
	expect(value("balance")).toBe("$10.00 (₹950)");
});

test("context/block/weekly usage paint only caution/critical; a nominal band stays default", () => {
	const val = (input: ComposeInputs, id: WidgetId) =>
		composeStatusline(input)
			.fields.find((f) => f.id === id)
			?.segments.find((s) => s.role === "value");

	expect(
		val({ ...base, context: { ...context, band: "nominal" } }, "context_usage")?.signal,
	).toBeUndefined();
	expect(
		val({ ...base, context: { ...context, band: "caution" } }, "context_usage")?.signal,
	).toBe("caution");

	const block = (band: "nominal" | "critical"): ComposeInputs => ({
		...base,
		quota: { block: { usedPct: band === "nominal" ? 10 : 90, band } },
	});
	expect(val(block("nominal"), "block_usage")?.signal).toBeUndefined();
	expect(val(block("critical"), "block_usage")?.signal).toBe("critical");

	const weeklyNominal: ComposeInputs = {
		...base,
		quota: { weekly: { usedPct: 10, band: "nominal" } },
	};
	expect(val(weeklyNominal, "weekly_usage")?.signal).toBeUndefined();
});

test("dropOrder keeps each row's anchor last and the session row has no protected anchor", () => {
	expect(dropOrder(1).at(-1)).toBe("model"); // identity row anchor
	expect(dropOrder(2).at(-1)).toBe("git_branch"); // git row anchor
	expect(dropOrder(3).at(-1)).toBe("cost_chat");
	expect(dropOrder(4).at(-1)).toBe("context_usage");
	// usage long-tail (block window) sheds first; the binding limit (weekly) survives near-last
	expect(dropOrder(4)[0]).toBe("block_usage");
	expect(dropOrder(5)).toEqual([
		"token_burn",
		"compactions",
		"cache_hit",
		"todo",
		"session_duration",
	]);
});

test("identity (provider/model/dir) sits on row 1; git on row 2", () => {
	for (const id of ["model", "fast_mode", "thinking", "output_style", "agent", "dir"] as const) {
		expect(FIELD_ROW[id]).toBe(1);
	}
	for (const id of ["git_branch", "git_hash", "git_status", "git_conflict", "pr"] as const) {
		expect(FIELD_ROW[id]).toBe(2);
	}
	expect(FIELD_ROW.cost_chat).toBe(3);
	expect(FIELD_ROW.context_usage).toBe(4);
});

test("rowFor promotes a lone git_branch to row 1; otherwise keeps it on row 2", () => {
	// Only git_branch among the git fields → promote to the identity row.
	expect(rowFor("git_branch", new Set(["model", "dir", "git_branch"]))).toBe(1);
	// Any other git field present → stays on the git row.
	expect(rowFor("git_branch", new Set(["git_branch", "git_hash"]))).toBe(2);
	expect(rowFor("git_branch", new Set(["git_branch", "pr"]))).toBe(2);
	// Every other field keeps its static row.
	expect(rowFor("model", new Set(["model"]))).toBe(1);
	expect(rowFor("git_hash", new Set(["git_branch", "git_hash"]))).toBe(2);
});

test("isProtected covers only the orientation + work-safety core", () => {
	for (const id of ["model", "dir", "git_branch", "context_usage"] as const) {
		expect(isProtected(id)).toBe(true);
	}
	for (const id of ["fast_mode", "git_hash", "cost_chat", "weekly_usage", "todo"] as const) {
		expect(isProtected(id)).toBe(false);
	}
});
