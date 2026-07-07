import { expect, test } from "bun:test";

import { asSession } from "../domain";
import { type Config, type SessionState, DEFAULT_CONFIG } from "../sources";

import { derivePersona } from "./persona";

const EMPTY_STATE: SessionState = { pressureFired: [], milestones: [], helpful: {} };

const withCharacter = (over: Partial<Config["character"]>): Config => ({
	...DEFAULT_CONFIG,
	character: { ...DEFAULT_CONFIG.character, ...over },
});

test("a persisted pick wins while it is still in the roster (sticky for the session)", () => {
	const state: SessionState = { ...EMPTY_STATE, character: "joker" };
	const cfg = withCharacter({ mode: "random", roster: ["batman", "joker"] });
	expect(derivePersona(cfg, state, asSession("s1"), [])).toBe("joker");
});

test("a persisted pick that has fallen out of the roster is re-derived, not sticky", () => {
	const state: SessionState = { ...EMPTY_STATE, character: "barbie" };
	const cfg = withCharacter({ mode: "random", roster: ["batman", "harry-potter", "spiderman"] });
	const pick = derivePersona(cfg, state, asSession("s1"), []);
	expect(pick).not.toBe("barbie");
	expect(cfg.character.roster).toContain(pick);
});

test("fixed mode returns the configured name", () => {
	const cfg = withCharacter({ mode: "fixed", name: "batman" });
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), ["batman", "robin"])).toBe("batman");
});

test("fixed mode drops a persisted pick that no longer matches the configured name", () => {
	const state: SessionState = { ...EMPTY_STATE, character: "joker" };
	const cfg = withCharacter({ mode: "fixed", name: "batman" });
	expect(derivePersona(cfg, state, asSession("s1"), ["batman", "joker"])).toBe("batman");
});

test("random is deterministic and stays within the candidate set", () => {
	const cfg = withCharacter({ mode: "random", roster: ["alpha", "bravo", "charlie", "delta"] });
	const pick = derivePersona(cfg, EMPTY_STATE, asSession("session-xyz"), []);
	expect(cfg.character.roster).toContain(pick);
	// stable for the same session id
	expect(derivePersona(cfg, EMPTY_STATE, asSession("session-xyz"), [])).toBe(pick);
});

test("random is invariant to input ordering (the set is sorted first)", () => {
	const cfg = withCharacter({ mode: "random", roster: [] });
	const sorted = derivePersona(cfg, EMPTY_STATE, asSession("abc"), ["a", "b", "c", "d", "e"]);
	const shuffled = derivePersona(cfg, EMPTY_STATE, asSession("abc"), ["d", "a", "e", "c", "b"]);
	expect(shuffled).toBe(sorted);
});

test("random resolves to batman when it is the only pack, and on empty everything", () => {
	const cfg = withCharacter({ mode: "random", roster: [] });
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), ["batman"])).toBe("batman");
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), [])).toBe("batman");
});

test("roster takes precedence over installed for the candidate set", () => {
	const cfg = withCharacter({ mode: "random", roster: ["only-rostered"] });
	expect(derivePersona(cfg, EMPTY_STATE, asSession("s1"), ["other", "packs"])).toBe(
		"only-rostered",
	);
});
