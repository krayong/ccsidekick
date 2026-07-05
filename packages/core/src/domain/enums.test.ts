import { expect, test } from "bun:test";

import {
	MOODS,
	PRESSURE_MOODS,
	TIERS,
	STACKS,
	EVENT_CATEGORIES,
	REACTION_CATEGORIES,
	SEVERITIES,
	PROVIDERS,
	isStack,
	isEventCategory,
} from "./enums";

test("vocabularies have the exact documented sizes", () => {
	expect(MOODS).toEqual(["idle", "busy", "happy", "struggling", "recovery"]);
	expect(PRESSURE_MOODS).toEqual(["compact_hint", "block_limit", "weekly_limit"]);
	expect(TIERS).toEqual(["stranger", "acquaintance", "friend", "partner", "legend"]);
	expect(SEVERITIES).toEqual(["none", "low", "medium", "high", "critical"]);
	expect(STACKS.length).toBe(27);
	expect(new Set(STACKS).size).toBe(27);
	expect(EVENT_CATEGORIES.length).toBe(31);
	expect(new Set(EVENT_CATEGORIES).size).toBe(31);
	expect(REACTION_CATEGORIES.length).toBe(18);
	expect(PROVIDERS.length).toBe(9);
});

test("guards narrow strings", () => {
	expect(isStack("rust")).toBe(true);
	expect(isStack("cobol")).toBe(false);
	expect(isEventCategory("test_pass")).toBe(true);
	expect(isEventCategory("git")).toBe(false); // a ReactionCategory cell, not an EventCategory
});
