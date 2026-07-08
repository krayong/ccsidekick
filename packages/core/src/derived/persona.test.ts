import { expect, test } from "bun:test";

import { asSession } from "../domain";
import { type AttributionStore, type Config, type SessionState, DEFAULT_CONFIG } from "../sources";

import { derivePersona } from "./persona";

const EMPTY_STATE: SessionState = { pressureFired: [], milestones: [], helpful: {} };
const NO_HISTORY: AttributionStore = {};

const withCharacter = (over: Partial<Config["character"]>): Config => ({
	...DEFAULT_CONFIG,
	character: { ...DEFAULT_CONFIG.character, ...over },
});

/** Build an attribution store from `sessionId → {character, updatedMs}`; the project is irrelevant here. */
const history = (
	rows: Record<string, { character: string; updatedMs: number }>,
): AttributionStore =>
	Object.fromEntries(
		Object.entries(rows).map(([id, r]) => [
			id,
			{ project: "p", character: r.character, updatedMs: r.updatedMs },
		]),
	);

test("a persisted pick wins while it is still in the roster (sticky for the session)", () => {
	const state: SessionState = { ...EMPTY_STATE, character: "joker" };
	const cfg = withCharacter({ mode: "random", roster: ["batman", "joker"] });
	expect(derivePersona(cfg, state, asSession("s1"), [], NO_HISTORY)).toBe("joker");
});

test("a persisted pick that has fallen out of the roster is re-derived, not sticky", () => {
	const state: SessionState = { ...EMPTY_STATE, character: "barbie" };
	const cfg = withCharacter({ mode: "random", roster: ["batman", "harry-potter", "spiderman"] });
	const pick = derivePersona(cfg, state, asSession("s1"), [], NO_HISTORY);
	expect(pick).not.toBe("barbie");
	expect(cfg.character.roster).toContain(pick);
});

test("fixed mode returns the configured name", () => {
	const cfg = withCharacter({ mode: "fixed", name: "batman" });
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), ["batman", "robin"], NO_HISTORY)).toBe(
		"batman",
	);
});

test("fixed mode drops a persisted pick that no longer matches the configured name", () => {
	const state: SessionState = { ...EMPTY_STATE, character: "joker" };
	const cfg = withCharacter({ mode: "fixed", name: "batman" });
	expect(derivePersona(cfg, state, asSession("s1"), ["batman", "joker"], NO_HISTORY)).toBe(
		"batman",
	);
});

test("random with no history is deterministic and stays within the candidate set", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo", "charlie", "delta"] });
	const pick = derivePersona(cfg, EMPTY_STATE, asSession("session-xyz"), [], NO_HISTORY);
	expect(cfg.character.roster).toContain(pick);
	// stable for the same session id
	expect(derivePersona(cfg, EMPTY_STATE, asSession("session-xyz"), [], NO_HISTORY)).toBe(pick);
});

test("random with no history is invariant to input ordering (the set is sorted first)", () => {
	const cfg = withCharacter({ mode: "random", roster: [] });
	const sorted = derivePersona(
		cfg,
		EMPTY_STATE,
		asSession("abc"),
		["a", "b", "c", "d", "e"],
		NO_HISTORY,
	);
	const shuffled = derivePersona(
		cfg,
		EMPTY_STATE,
		asSession("abc"),
		["d", "a", "e", "c", "b"],
		NO_HISTORY,
	);
	expect(shuffled).toBe(sorted);
});

test("random resolves to batman when it is the only pack, and on empty everything", () => {
	const cfg = withCharacter({ mode: "random", roster: [] });
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), ["batman"], NO_HISTORY)).toBe("batman");
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), [], NO_HISTORY)).toBe("batman");
});

test("roster takes precedence over installed for the candidate set", () => {
	const cfg = withCharacter({ mode: "random", roster: ["only-rostered"] });
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), ["other", "packs"], NO_HISTORY)).toBe(
		"only-rostered",
	);
});

test("random mode picks the least-recently-used candidate", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo", "charlie"] });
	const past = history({
		s_a: { character: "alpha", updatedMs: 100 },
		s_b: { character: "bravo", updatedMs: 300 },
		s_c: { character: "charlie", updatedMs: 200 },
	});
	expect(derivePersona(cfg, EMPTY_STATE, asSession("new"), [], past)).toBe("alpha");
});

test("a never-used candidate outranks any used one", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo", "charlie"] });
	const past = history({
		s_a: { character: "alpha", updatedMs: 100 },
		s_b: { character: "bravo", updatedMs: 200 },
	});
	expect(derivePersona(cfg, EMPTY_STATE, asSession("x"), [], past)).toBe("charlie");
});

test("a character's most recent use, not its oldest, sets its recency", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo"] });
	// alpha was used long ago AND very recently; bravo once in the middle. alpha is the most recent → bravo wins.
	const past = history({
		s_a_old: { character: "alpha", updatedMs: 10 },
		s_a_new: { character: "alpha", updatedMs: 900 },
		s_b: { character: "bravo", updatedMs: 500 },
	});
	expect(derivePersona(cfg, EMPTY_STATE, asSession("z"), [], past)).toBe("bravo");
});

test("ties in the least-recently-used group break by the deterministic hash", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo", "charlie"] });
	// charlie used recently; alpha & bravo tie as never-used.
	const past = history({ s_c: { character: "charlie", updatedMs: 500 } });
	const pick = derivePersona(cfg, EMPTY_STATE, asSession("sess-xyz"), [], past);
	expect(["alpha", "bravo"]).toContain(pick);
	// stable for the same session id
	expect(derivePersona(cfg, EMPTY_STATE, asSession("sess-xyz"), [], past)).toBe(pick);
});

test("the current session is excluded from its own recency", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo"] });
	// The current session ("cur") already recorded alpha very recently; another session used bravo earlier.
	// Excluding "cur", alpha has no other use → it is the least recently used.
	const past = history({
		cur: { character: "alpha", updatedMs: 1000 },
		other: { character: "bravo", updatedMs: 100 },
	});
	expect(derivePersona(cfg, EMPTY_STATE, asSession("cur"), [], past)).toBe("alpha");
});
