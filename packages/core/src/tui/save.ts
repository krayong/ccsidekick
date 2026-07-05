// The TUI's validating save path. It normalizes the draft config through `sources/config` defaults (so what
// lands on disk is exactly what the render path will read back), writes `config.toml`, computes the
// `spinnerVerbs` UNION the active config implies, and merges ccsidekick's wiring into `settings.json` via
// `cli/settings`. This module is plain Node code — no Ink/React — so it stays importable from tests without the
// UI runtime.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { stringify } from "smol-toml";

import { installSettings, writeConfigToml } from "../cli";
import { loadPack } from "../packs";
import { type Config, engineRoot, listInstalledPacks, loadConfig } from "../sources";

export type SaveScope = "global" | "local";

interface SaveOptions {
	/** Resolve a pack's spinner verbs by name; defaults to loading the pack's `spinnerVerbs`. */
	readonly resolveVerbs?: (name: string) => readonly string[];
	/** The installed-pack set used for a RANDOM mode + empty roster union; defaults to the real install scan. */
	readonly installed?: readonly string[];
	/** The project root for a local save; defaults to `process.cwd()`. */
	readonly cwd?: string;
	/** For a local save, also wire `./.claude/settings.json` (offered only when the project is unwired). */
	readonly wireLocalSettings?: boolean;
}

function defaultResolveVerbs(name: string): readonly string[] {
	const loaded = loadPack(name);
	return loaded.ok ? loaded.pack.spinnerVerbs : [];
}

function defaultInstalled(): readonly string[] {
	try {
		return listInstalledPacks(engineRoot(import.meta.url));
	} catch {
		return [];
	}
}

/**
 * The spinner-verb UNION the active config implies. FIXED mode contributes the active character's verbs; RANDOM
 * mode contributes the union over every candidate pack (the roster when non-empty, else every installed pack).
 * Order-stable: candidates are visited in declaration order and the first occurrence of each verb wins.
 */
export function spinnerVerbUnion(
	config: Config,
	resolveVerbs: (name: string) => readonly string[],
	installed: readonly string[],
): string[] {
	const candidates =
		config.character.mode === "fixed" ? [config.character.name]
		: config.character.roster.length > 0 ? [...config.character.roster]
		: [...installed];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of candidates) {
		for (const verb of resolveVerbs(name)) {
			if (!seen.has(verb)) {
				seen.add(verb);
				out.push(verb);
			}
		}
	}
	return out;
}

/** Normalize a draft through the loader's coercion + defaults, so the on-disk config round-trips cleanly. */
function normalize(config: Config): Config {
	return loadConfig(stringify(config));
}

/** The exact `config.toml` text `save()` would write for this draft (normalized through the loader's defaults). */
export function previewConfigToml(config: Config): string {
	return stringify(normalize(config));
}

/**
 * Validate and write the draft config, then wire `settings.json`. `dir` is the target Claude config dir. A
 * `global` save writes `<dir>/ccsidekick/config.toml` and wires `<dir>/settings.json`; a `local` save writes
 * `<cwd>/.ccsidekick/config.toml` and, when `wireLocalSettings`, also wires `<cwd>/.claude/settings.json`.
 */
export function save(
	config: Config,
	scope: SaveScope,
	dir: string,
	renderBin: string,
	opts: SaveOptions = {},
): void {
	const resolveVerbs = opts.resolveVerbs ?? defaultResolveVerbs;
	const installed = opts.installed ?? defaultInstalled();
	const cwd = opts.cwd ?? process.cwd();

	const normalized = normalize(config);
	const spinnerVerbs = spinnerVerbUnion(normalized, resolveVerbs, installed);

	if (scope === "global") {
		writeConfigToml(join(dir, "ccsidekick"), normalized);
		installSettings({ settingsPath: join(dir, "settings.json"), renderBin, spinnerVerbs });
		return;
	}

	writeConfigToml(join(cwd, ".ccsidekick"), normalized);
	if (opts.wireLocalSettings === true) {
		const claudeDir = join(cwd, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		installSettings({
			settingsPath: join(claudeDir, "settings.json"),
			renderBin,
			spinnerVerbs,
		});
	}
}
