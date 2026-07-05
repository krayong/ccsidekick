// Discovery for the launch-time Claude config-dir picker. Considers the `.claude*` directories directly under
// `$HOME` (plus `~/.claude` and an optional suggested dir), then lists ONLY those that already hold a
// `settings.json` — a real, wired Claude config dir; a fresh dir is reached through the picker's "Custom path…"
// entry instead. Reports which entry the picker should preselect. Pure and never-throwing.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface ConfigDirChoices {
	/** Absolute candidate dirs (each holds a `settings.json`), sorted. */
	readonly dirs: string[];
	/** Index the picker preselects: the suggested dir if listed, else `~/.claude` if listed, else 0. */
	readonly suggestedIndex: number;
}

/**
 * Discover Claude config-dir candidates under `homeDir`: directory entries whose name starts with `.claude`,
 * plus `${homeDir}/.claude` and `suggested` when set. Keeps only the candidates that contain a `settings.json`,
 * deduped and sorted. Never throws (a missing/unreadable `$HOME` simply contributes nothing).
 */
export function discoverConfigDirs(homeDir: string, suggested?: string): ConfigDirChoices {
	const home = join(homeDir, ".claude");
	const set = new Set<string>([home]);
	try {
		for (const entry of readdirSync(homeDir, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name.startsWith(".claude")) {
				set.add(join(homeDir, entry.name));
			}
		}
	} catch {
		// A missing or unreadable $HOME contributes no discoveries.
	}
	if (suggested !== undefined && suggested !== "") set.add(suggested);

	const dirs = [...set].filter((d) => existsSync(join(d, "settings.json"))).sort();

	let suggestedIndex = 0;
	if (suggested !== undefined && suggested !== "" && dirs.includes(suggested)) {
		suggestedIndex = dirs.indexOf(suggested);
	} else {
		const homeIdx = dirs.indexOf(home);
		if (homeIdx >= 0) suggestedIndex = homeIdx;
	}

	return { dirs, suggestedIndex };
}

/** Compress a `home` prefix in an absolute path to `~` for display. The real path is untouched by callers. */
export function tildePath(abs: string, home: string): string {
	if (abs === home) return "~";
	const prefix = home.endsWith("/") ? home : `${home}/`;
	return abs.startsWith(prefix) ? `~/${abs.slice(prefix.length)}` : abs;
}
