import { createHash } from "node:crypto";

import type { Session } from "../domain";
import type { AttributionStore, Config, SessionState } from "../sources";

/** The sorted candidate set: the roster when non-empty, else installed packs, else just batman. */
function candidateSet(config: Config, installed: readonly string[]): string[] {
	if (config.character.roster.length > 0) return [...config.character.roster].sort();
	if (installed.length > 0) return [...installed].sort();
	return ["batman"];
}

/**
 * `character → the most recent tick (ms) any prior session used it`, over the cross-session attribution store.
 * The current session is excluded so a session can never out-compete itself once its own row exists. A character
 * absent from the map has never been used and reads as recency 0 (the oldest possible), so it is preferred first.
 */
function lastUsedByCharacter(
	attribution: AttributionStore,
	currentSession: string,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [sessionId, entry] of Object.entries(attribution)) {
		if (sessionId === currentSession) continue;
		const ts = entry.updatedMs ?? 0;
		if (ts > (out[entry.character] ?? 0)) out[entry.character] = ts;
	}
	return out;
}

/**
 * The active character name. A persisted `state.character` is sticky for the session — but only while it stays
 * valid for the current config: in `fixed` mode it must equal the configured name, in `random` mode it must still
 * be a member of the candidate set (so narrowing the roster evicts a dropped character instead of letting it
 * stick). An invalid sticky pick falls through to a fresh derivation. `fixed` mode then returns the configured
 * name; `random` picks the least-recently-used candidate by cross-session attribution recency (a never-used one
 * wins outright), and breaks ties within the least-recently-used group by a stable sha1 hash of the Session id
 * over the **sorted** group (sorting makes the pick reproducible across machines, since directory-enumeration
 * order is not stable). With no history every candidate ties, so a fresh install falls straight through to the
 * hash pick. Persisting the pick is the caller's job.
 */
export function derivePersona(
	config: Config,
	state: SessionState,
	session: Session,
	installed: readonly string[],
	attribution: AttributionStore,
): string {
	const candidates = candidateSet(config, installed);
	const sticky = state.character;
	if (sticky !== undefined && sticky !== "" && stickyValid(config, candidates, sticky))
		return sticky;
	if (config.character.mode === "fixed") return config.character.name;

	const lastUsed = lastUsedByCharacter(attribution, String(session));
	const recency = (name: string): number => lastUsed[name] ?? 0;
	const oldest = Math.min(...candidates.map(recency));
	const tied = candidates.filter((name) => recency(name) === oldest);

	const hash = createHash("sha1").update(session).digest("hex");
	const idx = parseInt(hash.slice(0, 8), 16) % tied.length;
	return tied[idx] ?? "batman";
}

/** Whether a persisted character may still be honored: the configured name in fixed mode, a candidate in random. */
function stickyValid(config: Config, candidates: readonly string[], sticky: string): boolean {
	return config.character.mode === "fixed" ?
			sticky === config.character.name
		:	candidates.includes(sticky);
}
