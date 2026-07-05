// End-to-end over the pure render pipeline: hand-built derived structs (the phase-2 outputs) flow through the
// three compose layers, theme resolution, and frame selection into the two-zone layout — no disk, no network.
// Asserts the wide render, the narrow chip fallback, and the two comment-length caps against the fixture pack.

import { expect, test } from "bun:test";

import {
	composeCharacter,
	composeStatusline,
	type CharacterInputs,
	type ComposeInputs,
	type HelpfulInputs,
	resolveHelpful,
} from "../../src/compose";
import {
	type ContextInfo,
	type CostInfo,
	type ModelInfo,
	type ProviderInfo,
	type QuotaInfo,
} from "../../src/derived";
import { CHAR_LINE_MAX, HELPFUL_MAX_LEN, asSession, type PackJson } from "../../src/domain";
import { figureFits, layout, type LayoutInput, resolveTheme, stripAnsi } from "../../src/render";
import {
	DEFAULT_CONFIG,
	fixedClock,
	type GitState,
	type Payload,
	type SessionState,
	type TranscriptScan,
} from "../../src/sources";
import fixture from "../fixtures/packs/valid/pack.json" with { type: "json" };

const pack = fixture as unknown as PackJson;
const NOW = Date.parse("2024-06-10T10:15:00Z"); // Monday 10:15 UTC → morning bucket, no date surprise
const clock = fixedClock(NOW);

// --- Representative derived structs: a clean repo, a model, a small cost, a low-context band, idle mood. ---
const git: GitState = {
	branch: "main",
	staged: 0,
	unstaged: 0,
	untracked: [],
	conflict: 0,
	operation: "none",
	stash: 0,
	submoduleBranches: [],
	insertions: 0,
	deletions: 0,
	changedFiles: 0,
	upstream: false,
	upstreamGone: false,
};

const model: ModelInfo = {
	name: "Opus 4.8",
	contextLabel: "1M",
	fast: false,
	thinking: false,
};

const provider: ProviderInfo = {
	provider: "subscription",
	hasQuota: true,
	modelName: "Claude Opus 4.8",
	badge: "",
};

const context: ContextInfo = {
	usedPct: 12,
	usedTokens: 24_000,
	windowSize: 200_000,
	band: "nominal",
	compactions: 0,
	cacheHitPct: 50,
	compactPressure: false,
};

const cost: CostInfo = {
	chat: 1.23,
	project: 1.23,
	total: 44.1,
	costBurnPerHr: 0,
	tokenBurnPerMin: 0,
	pending: false,
};

const quota: QuotaInfo = {
	block: { usedPct: 18, band: "nominal", resetIn: "3hr left" },
	weekly: { usedPct: 61, band: "nominal" },
};

const payload: Payload = {
	workspace: { current_dir: "~/ccsidekick" },
	model: { display_name: "Opus 4.8" },
};

const scan: TranscriptScan = {
	tokens: {
		input: 1000,
		output: 500,
		cache_read: 4000,
		cache_creation_5m: 0,
		cache_creation_1h: 0,
	},
	messages: 12,
	compactions: 0,
	todos: [],
	burn: [],
	mtime: 0,
	size: 0,
};

const composeInputs: ComposeInputs = {
	provider,
	model,
	context,
	quota,
	cost,
	git,
	payload,
	scan,
	widgets: DEFAULT_CONFIG.line.widgets,
	currency: { code: "USD", rate: 1 },
	homeDir: "",
};

const charInputs: CharacterInputs = {
	pack,
	mood: "idle",
	freshEvent: null,
	stack: null,
	tier: "friend",
	firstContact: false,
	pending: { tier_up: false, comeback: false, streak: false, anniversary: false },
	state: { pressureFired: [], milestones: [] },
	clock,
	session: asSession("s1"),
	config: { enabled: DEFAULT_CONFIG.comments.enabled },
};

const helpfulInputs = (over: Partial<HelpfulInputs> = {}): HelpfulInputs => ({
	nowMs: NOW,
	payload,
	git,
	events: [],
	scan,
	helpfulEnv: {},
	quota,
	context,
	env: {
		hasApiKey: false,
		hasAuthToken: false,
		customBaseUrl: false,
		useBedrock: false,
		useVertex: false,
		useFoundry: false,
		useMantle: false,
		useAnthropicAws: false,
		managedByHost: false,
		hasOauthToken: false,
	},
	creds: null,
	balance: null,
	...over,
});

const emptyState: SessionState = { pressureFired: [], milestones: [], helpful: {} };

const buildLayoutInput = (columns: number, helpful: LayoutInput["helpful"]): LayoutInput => {
	const theme = resolveTheme(DEFAULT_CONFIG, () => null);
	const { fields, providerBadge } = composeStatusline(composeInputs);
	const { comment: character } = composeCharacter(charInputs);
	return {
		theme,
		frame: pack.art,
		figure: { hues: theme.logo.hues },
		dropped: !figureFits(columns),
		showChip: true,
		fields,
		helpful,
		character,
		providerBadge,
		name: pack.name,
		emblem: pack.emblem,
		mood: "idle",
		moodShift: DEFAULT_CONFIG.theme.mood_shift,
		now: NOW,
	};
};

const tty = (columns: number) => ({ columns, noColor: false, isTTY: true });

test("the wide render shows the model name and a colored separator", () => {
	const out = layout(buildLayoutInput(120, null), tty(120));
	const plain = stripAnsi(out);
	expect(plain).toContain("Opus 4.8 (1M)");
	expect(plain).toContain("│"); // the cell separator glyph
	expect(out).toContain("\x1b["); // …carried with SGR color
	expect(plain.split("\n").length).toBeGreaterThanOrEqual(9); // figure height
});

test("the narrow render collapses to the chip form", () => {
	const out = layout(buildLayoutInput(40, null), { columns: 40, noColor: true, isTTY: true });
	const lines = stripAnsi(out).split("\n");
	expect(lines[0]?.startsWith(`[${pack.name}] `)).toBe(true);
});

test("the character line never exceeds CHAR_LINE_MAX columns", () => {
	const { comment } = composeCharacter(charInputs);
	expect(comment).not.toBeNull();
	expect([...(comment?.text ?? "")].length).toBeLessThanOrEqual(CHAR_LINE_MAX);
});

test("[comments].enabled = false omits the character line (skipped, not hidden)", () => {
	// The fixture pack ships voice lines, so the character row renders when comments are enabled.
	const { comment: onComment } = composeCharacter(charInputs);
	expect(onComment).not.toBeNull();
	const enabled = stripAnsi(layout({ ...buildLayoutInput(120, null) }, tty(120)));
	expect(enabled).toContain(onComment?.text ?? "<none>");

	// Disabling comments yields no comment, and the rendered block omits the character row entirely.
	const offInput: LayoutInput = {
		...buildLayoutInput(120, null),
		character: composeCharacter({ ...charInputs, config: { enabled: false } }).comment,
	};
	expect(offInput.character).toBeNull();
	const disabled = stripAnsi(layout(offInput, tty(120)));
	expect(disabled).not.toContain(onComment?.text ?? "<none>");
	expect(disabled).toContain("Opus 4.8 (1M)"); // the rest of the statusline still renders
});

test("an active helpful comment is resolved and never exceeds HELPFUL_MAX_LEN", () => {
	const { comment } = resolveHelpful(
		helpfulInputs({ balance: { amount: 5, currency: "USD", ts: NOW } }),
		emptyState,
		clock,
		"low",
	);
	expect(comment).not.toBeNull();
	expect([...(comment?.text ?? "")].length).toBeLessThanOrEqual(HELPFUL_MAX_LEN);

	// …and it renders within the pipeline.
	const out = layout(buildLayoutInput(120, comment), tty(120));
	expect(stripAnsi(out)).toContain(comment?.text ?? "");
});

test("a clean repo surfaces only a low-severity helpful tip", () => {
	// No upstream on `main` is the one decoration-level nudge; nothing higher fires on a clean tree.
	const { comment } = resolveHelpful(helpfulInputs(), emptyState, clock, "low");
	expect(comment?.severity).toBe("low");
	expect([...(comment?.text ?? "")].length).toBeLessThanOrEqual(HELPFUL_MAX_LEN);
});
