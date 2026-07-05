import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { atomicWrite } from "../sources";

const HOOK_EVENTS = ["PostToolUse", "PostToolUseFailure", "PostToolBatch"] as const;

// A command of the form `<path>/ccsidekick-render[.js] render|classify` is ours; the bin basename is the tell,
// so a statusLine or hook pointing elsewhere (the user's own) is never matched.
const OUR_RENDER_RE = /(?:^|\/)ccsidekick-render(?:\.js)?\s+render$/;
const OUR_CLASSIFY_RE = /(?:^|\/)ccsidekick-render(?:\.js)?\s+classify$/;

const ISSUES_URL = "https://github.com/krayong/ccsidekick/issues";

interface UninstallOptions {
	readonly settingsPath: string;
	readonly restoreBackup?: boolean;
	readonly out?: (text: string) => void;
}

// JSON read off disk is `unknown`; these guards narrow it without `any`.
function asRecord(v: unknown): Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v) ?
			(v as Record<string, unknown>)
		:	{};
}

function asArray(v: unknown): readonly unknown[] {
	return Array.isArray(v) ? (v as readonly unknown[]) : [];
}

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

function isOurClassifyEntry(entry: unknown): boolean {
	return asArray(asRecord(entry)["hooks"]).some((h) => {
		const cmd = asRecord(h)["command"];
		return typeof cmd === "string" && OUR_CLASSIFY_RE.test(cmd);
	});
}

/** Whether a parsed `statusLine` value's `command` points at our render bin. Exported for reuse by the TUI's
 * save-target wiring check, which needs the same "is this already ours" test before offering to (re)wire. */
export function isOurStatusLine(v: unknown): boolean {
	const cmd = asRecord(v)["command"];
	return typeof cmd === "string" && OUR_RENDER_RE.test(cmd);
}

function isOurSpinnerVerbs(v: unknown): boolean {
	return asRecord(v)["mode"] === "replace";
}

/**
 * Restore the most recent `settings.json.ccsidekick-bak.<epoch>` over `settingsPath`. Returns the backup file
 * name that was restored, or `null` when no backup exists (a no-op the caller must not report as success).
 */
function restoreNewestBackup(settingsPath: string): string | null {
	const dir = dirname(settingsPath);
	const prefix = `${basename(settingsPath)}.ccsidekick-bak.`;
	let newest: { name: string; epoch: number } | undefined;
	for (const f of readdirSync(dir)) {
		if (!f.startsWith(prefix)) continue;
		const epoch = Number(f.slice(prefix.length));
		if (!Number.isFinite(epoch)) continue;
		if (newest === undefined || epoch > newest.epoch) newest = { name: f, epoch };
	}
	if (newest === undefined) return null;
	atomicWrite(settingsPath, readFileSync(join(dir, newest.name), "utf8"));
	return newest.name;
}

/** Restore the newest install backup, emitting a distinct message when none exists (a no-op, not "Uninstalled"). */
function runRestore(settingsPath: string, emit: (text: string) => void): void {
	const restored = existsSync(settingsPath) ? restoreNewestBackup(settingsPath) : null;
	if (restored === null) {
		emit(`\nNo ccsidekick backup found for ${settingsPath}; settings left unchanged.\n`);
		emit(`Re-run without --restore-backup to strip ccsidekick's entries instead.\n`);
		return;
	}
	emit(`\nRestored ${restored}. Report any issues at ${ISSUES_URL}\n`);
}

/**
 * Strip our entries from a parsed settings object. Drop our hook entries from the three event lists (keeping the
 * user's own and any other event; an event list emptied of everything but ours is removed) and preserve non-event
 * keys untouched. Remove `statusLine`/`spinnerVerbs` only when the statusLine is ours; rebuild without `delete` so
 * the pedantic index-signature/dynamic-delete rules stay satisfied.
 */
function stripSettings(parsed: Record<string, unknown>): Record<string, unknown> {
	const events = HOOK_EVENTS as readonly string[];
	const hooksOut: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(asRecord(parsed["hooks"]))) {
		if (!events.includes(key)) {
			hooksOut[key] = val;
			continue;
		}
		const kept = asArray(val).filter((e) => !isOurClassifyEntry(e));
		if (kept.length > 0) hooksOut[key] = kept;
	}

	const ownsStatusLine = isOurStatusLine(parsed["statusLine"]);
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(parsed)) {
		if (key === "hooks") continue;
		if (key === "statusLine" && ownsStatusLine) continue;
		if (key === "spinnerVerbs" && ownsStatusLine && isOurSpinnerVerbs(val)) continue;
		out[key] = val;
	}
	if (Object.keys(hooksOut).length > 0) out["hooks"] = hooksOut;
	return out;
}

/**
 * Reverse the settings wiring. Default (strip-keys, a merge-out preserving later edits): always remove our three
 * classify hook entries (keeping the user's own under the same event); remove `statusLine`/`spinnerVerbs` only
 * when the `statusLine` is ours (its command points at our render bin), so a statusLine/spinnerVerbs the user set
 * themselves is left intact. `restoreBackup` is the opt-in path that restores the newest install backup instead.
 * Installed packs and on-disk state are left in place.
 */
export function runUninstall(opts: UninstallOptions): void {
	const { settingsPath, restoreBackup = false } = opts;
	const emit =
		opts.out ??
		((t: string): void => {
			process.stdout.write(t);
		});

	if (restoreBackup) {
		runRestore(settingsPath, emit);
		return;
	}

	if (existsSync(settingsPath)) {
		const parsed = parseJsonObject(readFileSync(settingsPath, "utf8"));
		if (parsed === null) {
			throw new Error(
				`ccsidekick: refusing to modify unparseable settings at ${settingsPath}`,
			);
		}
		atomicWrite(settingsPath, `${JSON.stringify(stripSettings(parsed), null, 2)}\n`);
	}

	emit(`\nUninstalled. Report any issues at ${ISSUES_URL}\n`);
}
