import type { ContextInfo, CostInfo, ModelInfo, ProviderInfo, QuotaInfo } from "../derived";
import type { Field, Segment, SignalLevel, WidgetId } from "../domain";
import {
	fmtCurrency,
	fmtGap,
	fmtLocal,
	fmtUsd,
	fmtUsdTrim,
	humanize,
	localParen,
	pct,
} from "../format";
// Imported from the theme module directly, not the ../render barrel: the barrel pulls in the whole render tree,
// which closes a runtime import cycle back into compose (DEFAULT_ICONS reads undefined at module init).
// eslint-disable-next-line boundaries/dependencies -- deliberate deep import, see the note above (cycle avoidance)
import { DEFAULT_ICONS } from "../render/theme";
import type { GitState, Payload, TranscriptScan } from "../sources";

/** Row index, top to bottom. */
export type RowId = 1 | 2 | 3 | 4 | 5;

/**
 * Everything a single statusline tick needs: the derived structs plus the resolved widget toggles. Compose is
 * width-agnostic — fitting (figure deduction, separators, the pack chip) lives in `render/layout`.
 */
export interface ComposeInputs {
	readonly provider: ProviderInfo;
	readonly model: ModelInfo;
	readonly context: ContextInfo;
	readonly quota: QuotaInfo;
	readonly cost: CostInfo;
	readonly git: GitState | null;
	readonly payload: Payload;
	readonly scan: TranscriptScan;
	readonly widgets: Readonly<Record<WidgetId, boolean>>;
	/** The local-currency parenthetical inputs: the `[statusline].currency` code and its USD→code fx rate. */
	readonly currency: { readonly code: string; readonly rate: number };
	/** Absolute home dir for `$HOME → ~` relativization in the dir field; "" when unknown. */
	readonly homeDir: string;
}

interface RegistryEntry {
	readonly id: WidgetId;
	readonly row: RowId;
	readonly build: (ctx: ComposeInputs) => readonly Segment[] | null;
}

// Icon-bearing field glyphs, single-sourced from the engine's default icon set so the glyph list
// isn't duplicated. These are only compose-time fallbacks: the render path re-resolves every icon through the
// resolved theme (`applyThemeIcons`). A value-only field carries "" here and emits no icon segment.
const ICON = DEFAULT_ICONS;

/** Per-operation glyph for the in-progress git op field. */
const OP_ICON: Record<Exclude<GitState["operation"], "none">, string> = {
	rebase: "🌀",
	merge: "🤝",
	cherry_pick: "🍒",
	revert: "🔙",
};

const OP_LABEL: Record<Exclude<GitState["operation"], "none">, string> = {
	rebase: "rebase",
	merge: "merge",
	cherry_pick: "cherry-pick",
	revert: "revert",
};

/** Canonical label text, fixed per field (value-only fields carry none). */
const LABEL: Partial<Record<WidgetId, string>> = {
	output_style: "Style:",
	agent: "Agent:",
	context_usage: "Context Usage:",
	compactions: "Compactions:",
	cost_chat: "Chat Cost:",
	cost_project: "Project Cost:",
	cost_total: "Total Cost:",
	cost_burn: "Cost Burn:",
	block_usage: "Block Usage:",
	weekly_usage: "Weekly Usage:",
	balance: "Balance:",
	pay_as_you_go: "Cost/Limit:",
	cache_hit: "Cache Hit:",
	token_burn: "Token Burn:",
	session_duration: "Chat Duration:",
};

/** Assemble a field's segments: optional icon, optional label, then the required value (with optional signal). */
function field(id: WidgetId, value: string, signal?: SignalLevel): readonly Segment[] {
	const segs: Segment[] = [];
	const icon = ICON[id];
	if (icon !== undefined && icon !== "") segs.push({ role: "icon", text: icon });
	const label = LABEL[id];
	if (label !== undefined) segs.push({ role: "label", text: label });
	segs.push(
		signal !== undefined ?
			{ role: "value", text: value, signal }
		:	{ role: "value", text: value },
	);
	return segs;
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Paint a band only when it is elevated: a nominal band renders in the default accent, like the label. */
function elevated(level: SignalLevel): SignalLevel | undefined {
	return level === "nominal" ? undefined : level;
}

/** Map a GitHub PR review_state (free string, case-insensitive) to a signal; an unknown state stays unsigned. */
function reviewSignal(state: string): SignalLevel | undefined {
	switch (state.toLowerCase()) {
		case "approved":
			return "nominal";
		case "changes_requested":
		case "review_required":
			return "critical";
		case "commented":
		case "pending":
		case "dismissed":
			return "caution";
		default:
			return undefined;
	}
}

/** Replace a leading `$HOME` with `~` (exact home or a home-prefixed path); other paths pass through. */
function homeRelative(path: string, home: string): string {
	if (home === "") return path;
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	return path;
}

/** Field registry in fixed render order, grouped into the five rows. */
const FIELD_REGISTRY: readonly RegistryEntry[] = [
	// Row 1 — identity: provider badge (prefix) · dir (+ added_dirs/session_name) · model (+ thinking/fast/style/agent)
	{
		id: "dir",
		row: 1,
		build: (ctx) => {
			// Inside a git repo, show the repo root (not the in-repo sub-path); in a linked worktree show the
			// main checkout, since the worktree chip already names the worktree. Otherwise the cwd. Either way,
			// relativize against $HOME so the path reads as `~/…`.
			const raw =
				ctx.git?.mainRoot ??
				ctx.git?.root ??
				ctx.payload.workspace.current_dir ??
				ctx.payload.cwd ??
				"";
			if (raw === "") return null;
			return field("dir", homeRelative(raw, ctx.homeDir));
		},
	},
	{
		id: "added_dirs",
		row: 1,
		build: (ctx) => {
			const dirs = ctx.payload.workspace.added_dirs ?? [];
			if (dirs.length === 0) return null;
			const [first] = dirs;
			if (first === undefined) return null;
			const more = dirs.length - 1;
			return field("added_dirs", more > 0 ? `${first} +${more} more` : first);
		},
	},
	{
		id: "session_name",
		row: 1,
		build: (ctx) => {
			const name = ctx.payload.session_name;
			return name !== undefined && name !== "" ? field("session_name", name) : null;
		},
	},
	{
		id: "model",
		row: 1,
		build: (ctx) => {
			const m = ctx.model;
			if (m.name === "") return null;
			// The context-window size and effort are a protected tail (a separate value segment): under width
			// pressure the model name ellipsizes first and these survive (see `truncateField` in render/layout).
			const tail: string[] = [];
			if (m.contextLabel !== "") tail.push(`(${m.contextLabel})`);
			if (m.effort !== undefined) tail.push(`✦ ${m.effort}`);
			const segs: Segment[] = [...field("model", m.name)];
			if (tail.length > 0) segs.push({ role: "value", text: tail.join(" ") });
			return segs;
		},
	},
	{
		id: "thinking",
		row: 1,
		build: (ctx) => (ctx.model.thinking ? field("thinking", "Thinking…") : null),
	},
	{
		id: "fast_mode",
		row: 1,
		build: (ctx) => (ctx.model.fast ? field("fast_mode", "Fast") : null),
	},
	{
		id: "output_style",
		row: 1,
		build: (ctx) => {
			const style = ctx.model.outputStyle;
			// The default style carries no information; only render a non-default, non-empty style.
			if (style === undefined || style === "" || style === "default") return null;
			return field("output_style", style);
		},
	},
	{
		id: "agent",
		row: 1,
		build: (ctx) =>
			ctx.model.agentName !== undefined ? field("agent", ctx.model.agentName) : null,
	},
	// Row 2 — git: worktree · branch · hash · tag · pr · changes · ahead/behind · status · conflict · op · stash
	{
		id: "git_worktree",
		row: 2,
		build: (ctx) =>
			ctx.git?.worktree !== undefined ? field("git_worktree", ctx.git.worktree) : null,
	},
	{
		id: "git_branch",
		row: 2,
		build: (ctx) => {
			const g = ctx.git;
			if (g === null) return null;
			// Superproject branch first (omitted when detached), then `path@ref` per submodule, joined by ✦.
			const parts = g.branch !== undefined ? [g.branch] : [];
			for (const sub of g.submoduleBranches) parts.push(`${sub.path}@${sub.ref}`);
			return parts.length > 0 ? field("git_branch", parts.join(" ✦ ")) : null;
		},
	},
	{
		id: "git_hash",
		row: 2,
		build: (ctx) => (ctx.git?.sha !== undefined ? field("git_hash", ctx.git.sha) : null),
	},
	{
		id: "git_tag",
		row: 2,
		build: (ctx) => (ctx.git?.tag !== undefined ? field("git_tag", ctx.git.tag) : null),
	},
	{
		id: "pr",
		row: 2,
		build: (ctx) => {
			const n = ctx.payload.pr?.number;
			if (n === undefined) return null;
			const segs: Segment[] = [];
			const icon = ICON["pr"];
			if (icon !== undefined) segs.push({ role: "icon", text: icon });
			// Only the `#n` is the clickable, dotted-underlined link; the `PR:` lead-in stays plain text.
			segs.push({ role: "value", text: "PR:" });
			const url = ctx.payload.pr?.url;
			segs.push(
				url !== undefined && url !== "" ?
					{ role: "value", text: `#${n}`, href: url }
				:	{ role: "value", text: `#${n}` },
			);
			const state = ctx.payload.pr?.review_state;
			if (state !== undefined && state !== "") {
				const sig = reviewSignal(state);
				segs.push({ role: "value", text: "·" });
				segs.push(
					sig !== undefined ?
						{ role: "value", text: state, signal: sig }
					:	{ role: "value", text: state },
				);
			}
			return segs;
		},
	},
	{
		id: "git_changes",
		row: 2,
		build: (ctx) => {
			const ins = ctx.git?.insertions ?? 0;
			const del = ctx.git?.deletions ?? 0;
			const files = ctx.git?.changedFiles ?? 0;
			if (ins === 0 && del === 0 && files === 0) return null;
			const segs: Segment[] = [];
			if (ins > 0) segs.push({ role: "value", text: `+${ins}`, signal: "nominal" });
			if (del > 0) segs.push({ role: "value", text: `-${del}`, signal: "critical" });
			segs.push({
				role: "value",
				text: `${files} ${files === 1 ? "file" : "files"}`,
				signal: "caution",
			});
			return segs;
		},
	},
	{
		id: "git_ahead_behind",
		row: 2,
		build: (ctx) => {
			const ahead = ctx.git?.ahead ?? 0;
			const behind = ctx.git?.behind ?? 0;
			if (ahead === 0 && behind === 0) return null;
			// No icon (the arrows carry direction); each arrow takes its own signal — ahead nominal, behind critical.
			const segs: Segment[] = [];
			if (ahead > 0) segs.push({ role: "value", text: `↑${ahead}`, signal: "nominal" });
			if (behind > 0) segs.push({ role: "value", text: `↓${behind}`, signal: "critical" });
			return segs;
		},
	},
	{
		id: "git_status",
		row: 2,
		build: (ctx) => {
			const g = ctx.git;
			if (g === null) return null;
			const untracked = g.untracked.length;
			if (g.staged === 0 && g.unstaged === 0 && untracked === 0) return null;
			const parts: string[] = [];
			if (g.staged > 0) parts.push(`+${g.staged}`);
			if (g.unstaged > 0) parts.push(`!${g.unstaged}`);
			if (untracked > 0) parts.push(`?${untracked}`);
			return field("git_status", `(${parts.join(" ")})`);
		},
	},
	{
		id: "git_conflict",
		row: 2,
		build: (ctx) => {
			const c = ctx.git?.conflict ?? 0;
			if (c <= 0) return null;
			const op = ctx.git?.operation;
			const opActive = op !== undefined && op !== "none";
			// During an in-progress operation the conflict folds into the git_operation field (joined by ✦);
			// render it standalone only when no operation is active (or git_operation is disabled).
			if (opActive && ctx.widgets.git_operation) return null;
			return [
				{ role: "icon", text: ICON["git_conflict"] ?? "", signal: "critical" },
				{ role: "value", text: String(c), signal: "critical" },
			];
		},
	},
	{
		id: "git_operation",
		row: 2,
		build: (ctx) => {
			const op = ctx.git?.operation;
			if (op === undefined || op === "none") return null;
			// The operation (icon + label) reads caution.
			const segs: Segment[] = [
				{ role: "icon", text: OP_ICON[op], signal: "caution" },
				{ role: "value", text: OP_LABEL[op], signal: "caution" },
			];
			// Fold an active conflict in: a separator-colored ✦, then the conflict (icon + count) in critical.
			const c = ctx.git?.conflict ?? 0;
			if (c > 0 && ctx.widgets.git_conflict) {
				segs.push(
					{ role: "separator", text: "✦" },
					{ role: "icon", text: ICON["git_conflict"] ?? "", signal: "critical" },
					{ role: "value", text: String(c), signal: "critical" },
				);
			}
			return segs;
		},
	},
	{
		id: "git_stash",
		row: 2,
		build: (ctx) =>
			ctx.git !== null && ctx.git.stash > 0 ?
				field("git_stash", String(ctx.git.stash))
			:	null,
	},
	// Row 3 — cost
	{
		id: "cost_chat",
		row: 3,
		build: (ctx) =>
			ctx.cost.pending ?
				[{ role: "placeholder", text: "⋯" }]
			:	field("cost_chat", fmtCurrency(ctx.cost.chat, ctx.currency.rate, ctx.currency.code)),
	},
	{
		id: "cost_project",
		row: 3,
		build: (ctx) =>
			field(
				"cost_project",
				fmtCurrency(ctx.cost.project, ctx.currency.rate, ctx.currency.code),
			),
	},
	{
		id: "cost_total",
		row: 3,
		build: (ctx) =>
			field("cost_total", fmtCurrency(ctx.cost.total, ctx.currency.rate, ctx.currency.code)),
	},
	{
		id: "cost_burn",
		row: 3,
		build: (ctx) =>
			ctx.cost.costBurnPerHr > 0 ?
				field(
					"cost_burn",
					`${fmtUsd(ctx.cost.costBurnPerHr)}/h${localParen(`${fmtLocal(ctx.cost.costBurnPerHr, ctx.currency.rate, ctx.currency.code)}/h`, ctx.currency.code)}`,
				)
			:	null,
	},
	// Row 4 — context & usage
	{
		id: "context_usage",
		row: 4,
		build: (ctx) => {
			const c = ctx.context;
			if (c.windowSize <= 0) return null;
			const value = `${pct(c.usedPct)} (${humanize(c.usedTokens)}/${humanize(c.windowSize)})`;
			return field("context_usage", value, elevated(c.band));
		},
	},
	{
		id: "block_usage",
		row: 4,
		build: (ctx) => {
			const b = ctx.quota.block;
			if (b === undefined) return null;
			const value =
				b.resetIn !== undefined ? `${pct(b.usedPct)} (${b.resetIn})` : pct(b.usedPct);
			return field("block_usage", value, elevated(b.band));
		},
	},
	{
		id: "weekly_usage",
		row: 4,
		build: (ctx) => {
			const w = ctx.quota.weekly;
			if (w === undefined) return null;
			const value =
				w.resetIn !== undefined ? `${pct(w.usedPct)} (${w.resetIn})` : pct(w.usedPct);
			return field("weekly_usage", value, elevated(w.band));
		},
	},
	{
		id: "balance",
		row: 4,
		build: (ctx) => {
			const bal = ctx.quota.balance;
			if (bal === undefined) return null;
			// Append the local-currency conversion when the balance is in USD (bal.usd set);
			// localParen drops it when the line currency is itself USD (no redundant duplicate).
			const local =
				bal.usd !== undefined ?
					localParen(
						fmtLocal(bal.usd, ctx.currency.rate, ctx.currency.code),
						ctx.currency.code,
					)
				:	"";
			return field("balance", `${bal.label}${local}`, bal.band);
		},
	},
	{
		id: "pay_as_you_go",
		row: 4,
		build: (ctx) => {
			const p = ctx.quota.payg;
			if (p === undefined) return null;
			const local = (usd: number): string =>
				fmtLocal(usd, ctx.currency.rate, ctx.currency.code);
			// Group the USD pair, then the local pair: `$spend/$cap (local/local)`. Decimals drop when zero.
			// The local pair is dropped when the line currency is USD (no redundant duplicate).
			// Paint only when elevated: under the caution threshold the field stays default (no green).
			return p.monthlyLimit > 0 ?
					field(
						"pay_as_you_go",
						`${fmtUsdTrim(p.usedCredits)}/${fmtUsdTrim(p.monthlyLimit)}${localParen(`${local(p.usedCredits)}/${local(p.monthlyLimit)}`, ctx.currency.code)}`,
						elevated(p.band),
					)
				:	field(
						"pay_as_you_go",
						`${fmtUsdTrim(p.usedCredits)}${localParen(local(p.usedCredits), ctx.currency.code)} / ∞`,
						elevated(p.band),
					);
		},
	},
	// Row 5 — session & misc: session_duration · cache_hit · compactions · token_burn · todo
	{
		id: "session_duration",
		row: 5,
		build: (ctx) => {
			const ms = ctx.payload.cost?.total_duration_ms;
			return ms !== undefined && ms > 0 ? field("session_duration", fmtGap(ms)) : null;
		},
	},
	{
		id: "cache_hit",
		row: 5,
		build: (ctx) =>
			ctx.scan.messages > 0 ?
				field(
					"cache_hit",
					pct(ctx.context.cacheHitPct),
					ctx.context.cacheHitPct < 80 ? "critical" : undefined,
				)
			:	null,
	},
	{
		id: "compactions",
		row: 5,
		build: (ctx) =>
			ctx.context.compactions > 0 ?
				field("compactions", String(ctx.context.compactions))
			:	null,
	},
	{
		id: "token_burn",
		row: 5,
		build: (ctx) =>
			ctx.cost.tokenBurnPerMin > 0 ?
				field("token_burn", `${humanize(Math.round(ctx.cost.tokenBurnPerMin))}/m`)
			:	null,
	},
	{
		id: "todo",
		row: 5,
		build: (ctx) => {
			const inProgress = ctx.scan.todos.find((t) => t.status === "in_progress");
			if (inProgress === undefined) return null;
			const done = ctx.scan.todos.filter((t) => t.status === "completed").length;
			return field(
				"todo",
				`${truncate(inProgress.content, 50)} (${done}/${ctx.scan.todos.length})`,
			);
		},
	},
];

/** Field → row, so a consumer can regroup the flat ordered field list back into its five rows. */
export const FIELD_ROW: Readonly<Record<WidgetId, RowId>> = Object.fromEntries(
	FIELD_REGISTRY.map((e) => [e.id, e.row]),
) as Record<WidgetId, RowId>;

/**
 * The within-row shed order (lowest priority first, the row's anchor last): long-tail
 * metrics drop first, then secondary fields, then the row's anchor. PROTECTED ids are never removed (only the
 * last surviving value truncates), so the layout's drop loop skips them. The session row has no anchor.
 */
const DROP_ORDER: Readonly<Record<RowId, readonly WidgetId[]>> = {
	// Identity: model and dir are protected; the model flags and the dir companions shed first.
	1: [
		"session_name",
		"added_dirs",
		"agent",
		"output_style",
		"thinking",
		"fast_mode",
		"dir",
		"model",
	],
	// Git: git_branch is protected (drops last); the long-tail git fields shed first.
	2: [
		"git_stash",
		"git_status",
		"pr",
		"git_operation",
		"git_conflict",
		"git_ahead_behind",
		"git_changes",
		"git_worktree",
		"git_tag",
		"git_hash",
		"git_branch",
	],
	3: ["cost_burn", "cost_project", "cost_total", "cost_chat"],
	// Usage: context_usage is protected (drops last); the binding limit (weekly quota / prepaid balance) sheds
	// near-last so the resource you can actually run out of survives longest.
	4: ["block_usage", "pay_as_you_go", "balance", "weekly_usage", "context_usage"],
	// Session & misc: no protected anchor; the rate / ratio metrics shed first.
	5: ["token_burn", "compactions", "cache_hit", "todo", "session_duration"],
};

/** The within-row drop order for an overflowing row (drop-first → drop-last). */
export function dropOrder(row: RowId): readonly WidgetId[] {
	return DROP_ORDER[row];
}

/**
 * Fields that carry orientation or work-safety meaning — what model, where (dir), which branch, how full the
 * context is. The layout never removes these (only the last surviving value truncates), so losing them to a
 * narrow terminal can't cause a wrong-model / wrong-dir / wrong-branch mistake or a silent context overflow.
 */
const PROTECTED: ReadonlySet<WidgetId> = new Set(["model", "dir", "git_branch", "context_usage"]);

/** Whether `id` is never-drop (truncate-only) under width pressure. */
export function isProtected(id: WidgetId): boolean {
	return PROTECTED.has(id);
}

/** The non-branch git fields that normally sit on row 2; if none of these render, git_branch promotes to row 1. */
const GIT_SECONDARY: readonly WidgetId[] = [
	"git_hash",
	"git_tag",
	"git_worktree",
	"git_changes",
	"git_ahead_behind",
	"git_status",
	"git_conflict",
	"git_operation",
	"git_stash",
	"pr",
];

/**
 * The effective row for a field this render. Responsive to what is actually showing: when git_branch is the only
 * git field with data (every other git field rendered nothing), it promotes from row 2 up onto the identity row
 * so the lone branch does not strand an otherwise-empty git line. Every other field keeps its static row.
 */
export function rowFor(id: WidgetId, presentIds: ReadonlySet<WidgetId>): RowId {
	if (id === "git_branch" && !GIT_SECONDARY.some((g) => presentIds.has(g))) return 1;
	return FIELD_ROW[id];
}

/**
 * Compose the ordered statusline fields plus the provider badge. Each enabled, data-present widget renders to
 * an ordered run of role-tagged segments; a disabled or empty field is omitted. The badge is built separately
 * from the provider (null under a subscription) so `render/layout` can prepend it to the model row.
 */
export function composeStatusline(ctx: ComposeInputs): {
	fields: Field[];
	providerBadge: Segment[] | null;
} {
	const fields: Field[] = [];
	for (const entry of FIELD_REGISTRY) {
		if (!ctx.widgets[entry.id]) continue;
		const segments = entry.build(ctx);
		if (segments !== null) fields.push({ id: entry.id, segments });
	}

	const providerBadge: Segment[] | null =
		ctx.provider.provider === "subscription" || ctx.provider.badge === "" ?
			null
		:	[{ role: "value", text: ctx.provider.badge }];

	return { fields, providerBadge };
}
