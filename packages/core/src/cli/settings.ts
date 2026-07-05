import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { stringify } from "smol-toml";

import { REFRESH_INTERVAL_SEC } from "../domain";
import { type Config, atomicWrite } from "../sources";

/**
 * The hook matcher: the union of tool names the classify hook reacts to. Stays in lockstep with the
 * classifier tool-name map. `Agent` is the subagent tool; `TaskCreate`/`TaskUpdate` are the current task
 * tools; `Task`/`TodoWrite` are legacy aliases. There is no `MultiEdit`.
 */
const MATCHER =
	"Bash|Edit|Write|NotebookEdit|Read|Grep|Glob|WebFetch|WebSearch|Agent|TaskCreate|TaskUpdate|Task|Skill|TodoWrite";

/** Tool-success, tool-failure, and batched-tool-call hook surfaces — all wired to the same classify command. */
const HOOK_EVENTS = ["PostToolUse", "PostToolUseFailure", "PostToolBatch"] as const;

interface InstallSettingsOptions {
	readonly settingsPath: string;
	readonly renderBin: string;
	readonly spinnerVerbs: readonly string[];
}

// JSON read off disk is `unknown`; these guards narrow it without `any` so this module stays maximal-pedantic.
function asRecord(v: unknown): Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v) ?
			(v as Record<string, unknown>)
		:	{};
}

function asArray(v: unknown): readonly unknown[] {
	return Array.isArray(v) ? (v as readonly unknown[]) : [];
}

/** Parse `text` to a plain JSON object, or `null` for a parse error or any non-object (array, scalar). */
function parseJsonObject(text: string): Record<string, unknown> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
	return parsed as Record<string, unknown>;
}

function isOurClassifyEntry(entry: unknown, classifyCmd: string): boolean {
	return asArray(asRecord(entry)["hooks"]).some((h) => asRecord(h)["command"] === classifyCmd);
}

const backupPrefix = (settingsPath: string): string => `${basename(settingsPath)}.ccsidekick-bak.`;

/** Retain only the oldest (user's pre-install original) and newest ccsidekick backups; drop the rest. */
function pruneBackups(settingsPath: string): void {
	const dir = dirname(settingsPath);
	const prefix = backupPrefix(settingsPath);
	const baks = readdirSync(dir)
		.filter((f) => f.startsWith(prefix))
		.map((f) => ({ name: f, epoch: Number(f.slice(prefix.length)) }))
		.filter((b) => Number.isFinite(b.epoch))
		.sort((a, b) => a.epoch - b.epoch);
	for (const b of baks.slice(1, -1)) rmSync(join(dir, b.name), { force: true });
}

/**
 * Write `text` to `path` atomically (temp + rename), re-read it, and confirm it parses as a JSON object. On a
 * verify failure restore `restoreText` and throw — a user's `settings.json` is never left broken. Exported so
 * the verify+rollback contract can be exercised directly.
 */
export function safeWriteJson(path: string, text: string, restoreText: string): void {
	const tmp = `${path}.tmp.${String(process.pid)}.${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmp, text);
	renameSync(tmp, path);
	let ok = false;
	try {
		ok = parseJsonObject(readFileSync(path, "utf8")) !== null;
	} catch {
		ok = false;
	}
	if (!ok) {
		writeFileSync(path, restoreText);
		throw new Error(
			`ccsidekick: settings write failed verification at ${path}; restored prior content`,
		);
	}
}

/**
 * Merge ccsidekick's wiring into Claude Code's `settings.json`: a `statusLine` command (absolute render bin,
 * `refreshInterval` in seconds), the three classify hook entries (same matcher, same classify command), and a
 * top-level `spinnerVerbs` object (replace, not merge). All unrelated keys and the user's own hook entries are
 * preserved. Refuses to touch an unparseable file, writes one timestamped backup beside the file (retaining the
 * oldest and newest), and writes safely with a verify+rollback.
 */
export function installSettings(opts: InstallSettingsOptions): void {
	const { settingsPath, renderBin, spinnerVerbs } = opts;
	const exists = existsSync(settingsPath);
	let base: Record<string, unknown> = {};
	let originalText = "";
	if (exists) {
		originalText = readFileSync(settingsPath, "utf8");
		const parsed = parseJsonObject(originalText);
		if (parsed === null) {
			throw new Error(
				`ccsidekick: refusing to modify unparseable settings at ${settingsPath}`,
			);
		}
		base = parsed;
	}

	const classifyCmd = `${renderBin} classify`;
	const ourEntry = { matcher: MATCHER, hooks: [{ type: "command", command: classifyCmd }] };
	const hooks: Record<string, unknown> = { ...asRecord(base["hooks"]) };
	for (const evt of HOOK_EVENTS) {
		const kept = asArray(hooks[evt]).filter((e) => !isOurClassifyEntry(e, classifyCmd));
		hooks[evt] = [...kept, ourEntry];
	}

	const merged: Record<string, unknown> = {
		...base,
		statusLine: {
			type: "command",
			command: `${renderBin} render`,
			refreshInterval: REFRESH_INTERVAL_SEC,
		},
		hooks,
		spinnerVerbs: { mode: "replace", verbs: [...spinnerVerbs] },
	};

	if (exists) {
		writeFileSync(`${settingsPath}.ccsidekick-bak.${String(Date.now())}`, originalText);
		pruneBackups(settingsPath);
	}
	safeWriteJson(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, originalText);
}

/** Serialize the ccsidekick `Config` to `<root>/config.toml` (atomic write). */
export function writeConfigToml(root: string, config: Config): void {
	atomicWrite(join(root, "config.toml"), stringify(config));
}
