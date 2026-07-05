import { createHash } from "node:crypto";

import type { Session } from "../domain";
import type { Config, SessionState } from "../sources";

/** The sorted candidate set: the roster when non-empty, else installed packs, else just batman. */
function candidateSet(config: Config, installed: readonly string[]): string[] {
	if (config.character.roster.length > 0) return [...config.character.roster].sort();
	if (installed.length > 0) return [...installed].sort();
	return ["batman"];
}

/**
 * The active character name. A persisted `state.character` is sticky for the session and wins; else `fixed`
 * mode returns the configured name; else `random` picks deterministically by a stable sha1 hash of the
 * Session id over the **sorted** candidate set (sorting makes the pick reproducible across machines, since
 * directory-enumeration order for installed packs is not stable). Persisting the pick is the caller's job.
 */
export function derivePersona(
	config: Config,
	state: SessionState,
	session: Session,
	installed: readonly string[],
): string {
	if (state.character !== undefined && state.character !== "") return state.character;
	if (config.character.mode === "fixed") return config.character.name;

	const candidates = candidateSet(config, installed);
	const hash = createHash("sha1").update(session).digest("hex");
	const idx = parseInt(hash.slice(0, 8), 16) % candidates.length;
	return candidates[idx] ?? "batman";
}
