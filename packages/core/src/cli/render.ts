// The full render pipeline: stdin payload → acquire (staged) → derive (session first) → load pack → compose →
// render → stdout string, plus a best-effort `persist` thunk the bin runs after the line is flushed. The hot
// path imports no Ink/React and stays Node-portable. Acquisition is staged: payload + config + env first, then
// always-on reads, then gated reads only when config/env permit. Persist swallows every failure so a status
// line is never delayed or crashed by a write.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	type CharacterInputs,
	type CharacterResult,
	type ComposeInputs,
	type HelpfulInputs,
	type PendingMilestones,
	composeCharacter,
	composeStatusline,
	resolveHelpful,
} from "../compose";
import type { ThemeData } from "../data";
import {
	type Familiarity,
	deriveCost,
	deriveContext,
	deriveFamiliarity,
	deriveModel,
	deriveMood,
	derivePersona,
	deriveProject,
	deriveProvider,
	deriveQuota,
	deriveSession,
	deriveStacks,
	freshestEvent,
	pickStack,
	priceMessage,
	TIER_THRESHOLDS,
} from "../derived";
import {
	COMEBACK_GAP_DAYS,
	SESSION_MILESTONES,
	STREAK_MILESTONES,
	type Field,
	type Segment,
	type TermContext,
} from "../domain";
import { PACKS, loadPack } from "../packs";
import {
	type LayoutInput,
	type ResolvedTheme,
	figureFits,
	iconFor,
	layout,
	resolveTheme,
} from "../render";
import {
	type BalanceSnapshot,
	type Clock,
	type Config,
	type CredsInfo,
	type EnvInputs,
	type HelpfulEnv,
	type MarkerSet,
	type PriceFn,
	type ResolveProject,
	type UsageData,
	ccsidekickRoot,
	learnModelName,
	loadConfig,
	parsePayload,
	projectKeyForCwd,
	readAttribution,
	readBalance,
	readCostCache,
	readCreds,
	readEnv,
	readEvents,
	readFx,
	readFxCached,
	readGit,
	readHelpfulEnv,
	readMarkers,
	readModelAliases,
	readModelNames,
	readState,
	readUsage,
	readUsageCached,
	scanCostTree,
	scanTranscript,
	sessionDir,
	upsertAttribution,
	writeCostCache,
	writeState,
} from "../sources";

import { runGc } from "./gc";

interface RenderResult {
	readonly line: string;
	/** Best-effort, lock-guarded side effects run AFTER the line is flushed; never throws, never delays the line. */
	readonly persist: () => void;
}

const EMPTY_HELPFUL_ENV: HelpfulEnv = {};
const TIER_MILESTONES: ReadonlySet<number> = new Set(TIER_THRESHOLDS);
const YEAR_MS = 365 * 86_400_000;

function readTextSafe(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** Helpful env (kube/terraform context) is only read when the repo actually carries an infra stack. */
function needsHelpfulEnv(markers: MarkerSet): boolean {
	return markers.stacks.has("kubernetes") || markers.stacks.has("terraform");
}

/** The pending relationship milestones for this tick, derived from the render-subset familiarity. */
function pendingMilestones(fam: Familiarity, clock: Clock): PendingMilestones {
	const anniversaryByCount = (SESSION_MILESTONES as readonly number[]).includes(fam.sessionCount);
	const anniversaryByYear = fam.workingSinceMs > 0 && clock.now() - fam.workingSinceMs >= YEAR_MS;
	return {
		tier_up: TIER_MILESTONES.has(fam.sessionCount),
		comeback:
			Number.isFinite(fam.daysSinceLastSession) &&
			fam.daysSinceLastSession >= COMEBACK_GAP_DAYS,
		streak: (STREAK_MILESTONES as readonly number[]).includes(fam.currentStreakDays),
		anniversary: anniversaryByCount || anniversaryByYear,
	};
}

/**
 * Re-resolve every field's icon glyph through the RESOLVED theme (config ← pack ← engine default), so a
 * `[theme.icons]` override or a pack icon reaches stdout instead of the compose-layer default. `git_operation`
 * keeps its per-operation glyph unless a flat config override is supplied; an icon resolved to "" is dropped.
 */
export function applyThemeIcons(
	fields: readonly Field[],
	theme: ResolvedTheme,
	config: Config,
): Field[] {
	return fields.map((f) => {
		let iconIdx = 0;
		return {
			id: f.id,
			segments: f.segments.flatMap((seg): Segment[] => {
				if (seg.role !== "icon") return [seg];
				const at = iconIdx;
				iconIdx += 1;
				// git_operation carries two icon segments: the op glyph first, then a folded git_conflict warning.
				// Theme only the op glyph via the git_operation key; resolve the conflict warning by its own key so
				// a git_operation override cannot clobber it.
				const glyph =
					f.id === "git_operation" ?
						at === 0 ?
							(config.theme.icons["git_operation"] ?? seg.text)
						:	iconFor("git_conflict", theme, config)
					:	iconFor(f.id, theme, config);
				return glyph === "" ? [] : [{ ...seg, text: glyph }];
			}),
		};
	});
}

interface GatedReads {
	readonly creds: CredsInfo | null;
	readonly usage: UsageData | null;
	readonly balance: BalanceSnapshot | null;
	readonly helpfulEnv: HelpfulEnv;
}

/** Stage 2: the reads that only run when config/env permit (or a preview override supplies the value). */
function readGated(
	overrides: RenderOverrides | undefined,
	envInputs: EnvInputs,
	config: Config,
	root: string,
	dir: string,
	markers: MarkerSet,
	clock: Clock,
): GatedReads {
	const creds =
		overrides?.creds !== undefined ? overrides.creds
		: envInputs.hasApiKey || config.network.usage_fetch ? readCreds()
		: null;
	const usage =
		overrides?.usage !== undefined ? overrides.usage
		: config.network.usage_fetch ? readUsageCached(root)
		: null;
	const balance =
		overrides?.balance !== undefined ? overrides.balance
		: config.network.balance_path !== "" ? readBalance(config.network.balance_path, clock)
		: null;
	const helpfulEnv = needsHelpfulEnv(markers) ? readHelpfulEnv(dir) : EMPTY_HELPFUL_ENV;
	return { creds, usage, balance, helpfulEnv };
}

const DEFAULT_EMBLEM = "❝";

/** Map an installed pack's theme block to a ThemeData, by pack name; null if absent/unloadable. */
function lookupPackTheme(name: string): ThemeData | null {
	const loaded = loadPack(name);
	if (!loaded.ok || loaded.pack.theme === undefined) return null;
	return { displayName: loaded.pack.displayName, ...loaded.pack.theme };
}

const NOOP = (): void => {
	/* nothing to persist on a degraded render */
};

/** Preview-only overrides: when a field is present it replaces the matching internal reader. */
export interface RenderOverrides {
	readonly creds?: CredsInfo | null;
	readonly usage?: UsageData | null;
	readonly balance?: BalanceSnapshot | null;
}

/**
 * Run the full render pipeline for one statusline tick. Pure of process state beyond the injected `env`/`term`/
 * `clock`: never throws (a malformed payload or a failing source degrades to a safe line), and the returned
 * `persist` is the only writer. Wire it only for the main agent's `statusLine`, never a subagent.
 */
export function runRender(
	stdin: string,
	env: NodeJS.ProcessEnv,
	term: TermContext,
	clock: Clock,
	overrides?: RenderOverrides,
): RenderResult {
	try {
		return build(stdin, env, term, clock, overrides);
	} catch {
		return { line: "", persist: NOOP };
	}
}

function build(
	stdin: string,
	env: NodeJS.ProcessEnv,
	term: TermContext,
	clock: Clock,
	overrides?: RenderOverrides,
): RenderResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdin);
	} catch {
		return { line: "", persist: NOOP };
	}
	const payload = parsePayload(parsed);
	if (payload === null) return { line: "", persist: NOOP };

	// ── Stage 0: payload + config + env + paths ─────────────────────────────────
	const root = ccsidekickRoot(env);
	const base = dirname(root);
	const projectsRoot = join(base, "projects");
	const dir = payload.workspace.current_dir ?? payload.cwd ?? process.cwd();

	const globalToml = readTextSafe(join(root, "config.toml"));
	const projectToml = readTextSafe(join(dir, ".ccsidekick", "config.toml"));
	const config = loadConfig(globalToml, projectToml);

	const envInputs = readEnv(env);
	const aliases = readModelAliases(env);
	const price: PriceFn = (usage, modelId, atMs) => priceMessage(usage, modelId, aliases, atMs);

	// ── Stage 1: always-on reads + session identity (seeds persona) ─────────────
	const git = readGit(dir);
	const markers = readMarkers(dir);
	const session = deriveSession(payload);
	const isDefault = String(session) === "default";
	const sDir = sessionDir(root, session);
	const events = readEvents(sDir, clock);
	const sessionState = readState(sDir);
	const attribution = readAttribution(root);
	const costCache = readCostCache(root);
	const fxTable = readFxCached(root);

	// ── Stage 2: gated reads (only when config/env permit) ──────────────────────
	const { creds, usage, balance, helpfulEnv } = readGated(
		overrides,
		envInputs,
		config,
		root,
		dir,
		markers,
		clock,
	);

	// ── Derive: session → persona → the rest ────────────────────────────────────
	// The candidate set for a random pick with an empty roster is the full bundled registry (`PACKS`); it never
	// needs a filesystem scan, since every pack ships with the engine.
	const persona = derivePersona(config, sessionState, session, PACKS);
	const loaded = loadPack(persona);
	const pack = loaded.ok ? loaded.pack : null;

	const project = deriveProject(git, payload);
	const projectKey = projectKeyForCwd(payload.workspace.current_dir ?? payload.cwd ?? "");
	const resolveProject: ResolveProject = (sess, decodedCwd) =>
		sess === String(session) ? String(project) : decodedCwd;

	const scan = scanTranscript(payload.transcript_path ?? "", clock, price);
	const scannedCache = scanCostTree(projectsRoot, costCache, clock, price, resolveProject);

	// A Bedrock inference-profile ARN carries no model name, and Claude Code only fills `display_name` once the
	// model resolves — early-session ticks send the bare ARN. Fall back to the name learned in an earlier session
	// (the ARN → model binding is immutable) so the model field never flashes the raw ARN; learn it in `persist`.
	const modelNames = readModelNames(root);
	const rawModelId = payload.model.id ?? "";
	const rawModelName = payload.model.display_name?.trim() ?? "";
	const isArnModel = rawModelId.startsWith("arn:aws:bedrock:");
	const learnedName = modelNames[rawModelId];
	const providerPayload =
		(
			isArnModel &&
			(rawModelName === "" || rawModelName === rawModelId) &&
			learnedName !== undefined
		) ?
			{ ...payload, model: { ...payload.model, display_name: learnedName } }
		:	payload;

	const provider = deriveProvider(envInputs, providerPayload, creds, scan.messages > 0);
	const model = deriveModel(payload, provider, scan);
	const context = deriveContext(payload, scan);
	const quota = deriveQuota(payload, usage, balance, clock);
	const cost = deriveCost(
		{ aggregate: scannedCache.aggregate, lastScanTs: scannedCache.lastScanTs },
		scan.burn,
		payload,
		session,
		projectKey,
		clock,
	);
	const mood = deriveMood(events, payload, quota, context, clock);
	const stacks = deriveStacks(markers, events);
	const fresh = freshestEvent(events);
	const stack = pickStack(stacks, fresh?.stack);
	const familiarity = deriveFamiliarity(attribution, persona, scannedCache, project, clock);

	// ── Compose ─────────────────────────────────────────────────────────────────
	const theme = resolveTheme(config, lookupPackTheme, persona);
	const composeInputs: ComposeInputs = {
		provider,
		model,
		context,
		quota,
		cost,
		git,
		payload,
		scan,
		widgets: config.statusline.widgets,
		currency: {
			code: config.statusline.currency,
			rate: fxTable[config.statusline.currency] ?? 0,
		},
		homeDir: env["HOME"] ?? "",
	};
	const composed = composeStatusline(composeInputs);
	const fields = applyThemeIcons(composed.fields, theme, config);

	const helpfulInputs: HelpfulInputs = {
		nowMs: clock.now(),
		payload,
		git,
		events,
		scan,
		helpfulEnv,
		quota,
		context,
		env: envInputs,
		creds,
		balance,
	};
	const helpfulResult =
		config.comments.helpful ?
			resolveHelpful(helpfulInputs, sessionState, clock, config.comments.min_severity)
		:	{ comment: null, nextHelpful: sessionState.helpful };
	const helpful = helpfulResult.comment;

	const pending = pendingMilestones(familiarity, clock);
	const charBase = {
		pressureFired: sessionState.pressureFired,
		milestones: sessionState.milestones,
	};
	let charResult: CharacterResult = { comment: null, nextState: charBase };
	if (pack !== null) {
		// A pack with incomplete voice pools must degrade to no comment, never crash the render.
		try {
			charResult = composeCharacter({
				pack,
				mood,
				freshEvent: fresh,
				stack,
				tier: familiarity.tier,
				firstContact: !familiarity.seenProject,
				pending,
				state: sessionState,
				clock,
				session,
				config: { enabled: config.comments.character },
			} satisfies CharacterInputs);
		} catch {
			charResult = { comment: null, nextState: charBase };
		}
	}

	// ── Render ──────────────────────────────────────────────────────────────────
	const characterEnabled = config.character.enabled;
	const fits = figureFits(term.columns);
	const dropped = pack === null || !characterEnabled || !fits;
	const showChip = pack === null || (characterEnabled && !fits);
	const nowMs = clock.now();

	const layoutInput: LayoutInput = {
		theme,
		frame: pack !== null && characterEnabled ? pack.art : [],
		figure: { hues: theme.logo.hues },
		dropped,
		showChip,
		fields,
		helpful,
		character: charResult.comment,
		providerBadge: composed.providerBadge,
		name: pack?.name ?? persona,
		emblem: pack?.emblem ?? DEFAULT_EMBLEM,
		mood,
		moodShift: config.theme.mood_shift,
		now: nowMs,
	};
	const line = layout(layoutInput, term);

	// ── Persist (best-effort; runs after the line is flushed) ────────────────────
	const persist = (): void => {
		swallow(() => {
			upsertAttribution(root, String(session), {
				project: String(project),
				character: persona,
			});
		});
		if (!isDefault) {
			swallow(() => {
				writeState(sDir, {
					character: persona,
					pressureFired: charResult.nextState.pressureFired,
					milestones: charResult.nextState.milestones,
					helpful: helpfulResult.nextHelpful,
				});
			});
		}
		swallow(() => {
			// Remember the current session's authoritative payload cost so Total/Project reconcile across
			// ticks. The "default" session is never recorded.
			const payloadChat = payload.cost?.total_cost_usd;
			const toWrite =
				!isDefault && payloadChat !== undefined ?
					{
						...scannedCache,
						aggregate: {
							...scannedCache.aggregate,
							chat: {
								...scannedCache.aggregate.chat,
								[String(session)]: payloadChat,
							},
						},
					}
				:	scannedCache;
			writeCostCache(root, toWrite);
		});
		swallow(() => {
			// Learn this session's ARN → resolved display name so later sessions skip the early-tick ARN flash.
			if (isArnModel && rawModelName !== "" && rawModelName !== rawModelId) {
				learnModelName(root, modelNames, rawModelId, rawModelName);
			}
		});
		swallow(() => {
			void readFx(root, clock, { enabled: config.network.fx_refresh });
		});
		swallow(() => {
			void readUsage(root, clock, { enabled: config.network.usage_fetch });
		});
		swallow(() => {
			runGc(root, clock);
		});
	};

	return { line, persist };
}

function swallow(fn: () => void): void {
	try {
		fn();
	} catch {
		/* best effort: a failed write must never crash or delay the render */
	}
}
