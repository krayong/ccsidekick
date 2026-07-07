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
 * The active character name. A persisted `state.character` is sticky for the session — but only while it stays
 * valid for the current config: in `fixed` mode it must equal the configured name, in `random` mode it must still
 * be a member of the candidate set (so narrowing the roster evicts a dropped character instead of letting it
 * stick). An invalid sticky pick falls through to a fresh derivation. `fixed` mode then returns the configured
 * name; `random` picks deterministically by a stable sha1 hash of the Session id over the **sorted** candidate set
 * (sorting makes the pick reproducible across machines, since directory-enumeration order is not stable).
 * Persisting the pick is the caller's job.
 */
export function derivePersona(
	config: Config,
	state: SessionState,
	session: Session,
	installed: readonly string[],
): string {
	const candidates = candidateSet(config, installed);
	const sticky = state.character;
	if (sticky !== undefined && sticky !== "" && stickyValid(config, candidates, sticky))
		return sticky;
	if (config.character.mode === "fixed") return config.character.name;

	const hash = createHash("sha1").update(session).digest("hex");
	const idx = parseInt(hash.slice(0, 8), 16) % candidates.length;
	return candidates[idx] ?? "batman";
}

/** Whether a persisted character may still be honored: the configured name in fixed mode, a candidate in random. */
function stickyValid(config: Config, candidates: readonly string[], sticky: string): boolean {
	return config.character.mode === "fixed" ?
			sticky === config.character.name
		:	candidates.includes(sticky);
}
