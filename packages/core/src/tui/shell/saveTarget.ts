// The per-target save model: one install can write to several targets, each with its own scope. Home dirs are
// always global; only a project target can be local (see save.ts's local branch, which writes to `cwd`).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SaveScope } from "..";
import { isOurStatusLine } from "../../cli";

export interface SaveTarget {
	readonly dir: string; // the display / config dir (a home Claude dir, or the project's ./.claude)
	readonly scope: SaveScope;
	readonly cwd?: string; // the project root, set only for a local target
	readonly wireLocalSettings?: boolean; // local: also wire ./.claude/settings.json (only when unwired)
}

/** The header chip: "global" if every target is global, "local" if every target is local, else "mixed". */
export function chipFor(targets: readonly SaveTarget[]): "global" | "local" | "mixed" {
	if (targets.every((t) => t.scope === "global")) return "global";
	if (targets.every((t) => t.scope === "local")) return "local";
	return "mixed";
}

/**
 * Whether `settingsPath` is already wired to ccsidekick: it exists, parses as JSON, and its `statusLine.command`
 * points at our render bin. Absent, unparseable, or present-but-unwired all read as "not wired" — `installSettings`
 * is a non-destructive merge (it spreads the existing settings and only overwrites the keys it owns), so any of
 * those cases should still be offered wiring rather than skipped.
 */
function alreadyWired(settingsPath: string): boolean {
	if (!existsSync(settingsPath)) return false;
	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { statusLine?: unknown };
		return isOurStatusLine(parsed.statusLine);
	} catch {
		return false;
	}
}

/**
 * The current project as a selectable local target: `<cwd>/.claude`, offering to wire its `settings.json` only
 * when the project isn't already wired. `homeDir` is accepted for parity with `discoverConfigDirs`'s home-relative
 * discovery; the project's target never depends on it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- homeDir kept for call-site symmetry, see above
export function projectTarget(cwd: string, _homeDir: string): SaveTarget {
	const dir = join(cwd, ".claude");
	return {
		dir,
		scope: "local",
		cwd,
		wireLocalSettings: !alreadyWired(join(dir, "settings.json")),
	};
}
