import { expect, test } from "bun:test";

import fixture from "../../test/fixtures/packs/valid/pack.json" with { type: "json" };
import { CHAR_LINE_MAX, asSession, type PackJson } from "../domain";
import { displayWidth } from "../render";
import { fixedClock } from "../sources";

import { composeCharacter, type CharacterInputs, type PendingMilestones } from "./character";

const pack = fixture as unknown as PackJson;

const NO_MILESTONES: PendingMilestones = {
	tier_up: false,
	comeback: false,
	streak: false,
	anniversary: false,
};

// A weekday, mid-hour, non-new-year instant: no date/clock surprise, so the low slot resolves to a greeting.
const PLAIN = Date.parse("2024-06-10T10:15:00Z"); // Monday 10:15 UTC → morning bucket

const base = (over: Partial<CharacterInputs> = {}): CharacterInputs => ({
	pack,
	mood: "idle",
	freshEvent: null,
	stack: null,
	tier: "friend",
	firstContact: false,
	pending: NO_MILESTONES,
	state: { pressureFired: [], milestones: [] },
	clock: fixedClock(PLAIN),
	session: asSession("s1"),
	config: { enabled: true },
	...over,
});

const BASE_MOODS = ["idle", "busy", "happy", "struggling", "recovery"] as const;
const TIERS = ["stranger", "acquaintance", "friend", "partner", "legend"] as const;
const PRESSURE_MOODS = ["compact_hint", "block_limit", "weekly_limit"] as const;

test("disabled comments omit the row", () => {
	expect(composeCharacter(base({ config: { enabled: false } })).comment).toBeNull();
});

test("a character line always renders for a loaded pack across base moods and tiers", () => {
	for (const mood of BASE_MOODS) {
		for (const tier of TIERS) {
			const { comment } = composeCharacter(base({ mood, tier }));
			expect(comment).not.toBeNull();
			expect((comment?.text ?? "").length).toBeGreaterThan(0);
		}
	}
});

test("event reaction beats mood", () => {
	const out = composeCharacter(
		base({ mood: "busy", freshEvent: { ts: PLAIN, category: "test_fail" } }),
	);
	expect(out.comment?.text).toBe("event test_fail reaction");
});

test("file_read has no reaction cell, so it falls through to mood", () => {
	const out = composeCharacter(
		base({ mood: "busy", freshEvent: { ts: PLAIN, category: "file_read" } }),
	);
	expect(out.comment?.text).toBe("mood busy friend line");
});

test("neutral git outcomes collapse to the single git cell", () => {
	const out = composeCharacter(
		base({ mood: "busy", freshEvent: { ts: PLAIN, category: "git_commit" } }),
	);
	expect(out.comment?.text).toBe("event git reaction");
});

test("positive git moment is tier-nested and wins the event slot", () => {
	const out = composeCharacter(base({ positiveGit: "clean_tree" }));
	expect(out.comment?.text).toBe("git clean_tree friend line");
});

test("first contact wins the whole chain", () => {
	const out = composeCharacter(base({ firstContact: true, mood: "busy" }));
	expect(out.comment?.text).toBe("first contact friend line");
});

test("idle greeting uses the time-of-day bucket and tier", () => {
	const out = composeCharacter(base({ mood: "idle" }));
	expect(out.comment?.text).toBe("greeting morning friend line");
});

test("deterministic pick is stable for a fixed situation", () => {
	const a = composeCharacter(base({ mood: "idle" })).comment?.text;
	const b = composeCharacter(base({ mood: "idle" })).comment?.text;
	expect(a).toBe(b);
});

test("a date/clock surprise selects the dateEgg pool", () => {
	const out = composeCharacter(base({ clock: fixedClock(0) })); // 1970-01-01 00:00 UTC
	expect(["a special-day easter egg", "another date egg"]).toContain(out.comment?.text ?? "");
});

test("every pressure mood renders its line and latches pressureFired once", () => {
	for (const mood of PRESSURE_MOODS) {
		const out = composeCharacter(base({ mood }));
		expect(out.comment?.text).toBe(`pressure ${mood}`);
		expect(out.nextState.pressureFired).toContain(mood);
	}
});

test("an already-fired pressure mood falls through to a rendered line", () => {
	const out = composeCharacter(
		base({ mood: "block_limit", state: { pressureFired: ["block_limit"], milestones: [] } }),
	);
	expect(out.comment).not.toBeNull();
	expect(out.comment?.text).not.toBe("pressure block_limit");
});

test("idle milestone renders with tier_up precedence and latches once", () => {
	const out = composeCharacter(
		base({ mood: "idle", pending: { ...NO_MILESTONES, tier_up: true, streak: true } }),
	);
	expect(out.comment?.text).toBe("milestone tier_up friend line");
	expect(out.nextState.milestones).toContain("tier_up");
});

test("an already-latched milestone does not repeat", () => {
	const out = composeCharacter(
		base({
			mood: "idle",
			pending: { ...NO_MILESTONES, tier_up: true },
			state: { pressureFired: [], milestones: ["tier_up"] },
		}),
	);
	// Falls through to the greeting once the milestone is latched.
	expect(out.comment?.text).toBe("greeting morning friend line");
});

test("an over-long line is capped to exactly CHAR_LINE_MAX columns with an ellipsis", () => {
	const long = "x".repeat(200);
	const longPack: PackJson = {
		...pack,
		lines: { ...pack.lines, event: { ...pack.lines.event, test_fail: [long] } },
	};
	const out = composeCharacter(
		base({ pack: longPack, mood: "busy", freshEvent: { ts: PLAIN, category: "test_fail" } }),
	);
	expect(displayWidth(out.comment?.text ?? "")).toBe(CHAR_LINE_MAX);
	expect(out.comment?.text.endsWith("…")).toBe(true);
});

test("a pack with no line for any reachable slot renders nothing", () => {
	const voiceless: PackJson = {
		...pack,
		lines: {
			...pack.lines,
			mood: { ...pack.lines.mood, idle: { ...pack.lines.mood.idle, friend: [] } },
			greeting: {
				...pack.lines.greeting,
				morning: { ...pack.lines.greeting.morning, friend: [] },
			},
			egg: { ...pack.lines.egg, friend: [] },
			dateEgg: [],
		},
	};
	expect(composeCharacter(base({ pack: voiceless })).comment).toBeNull();
});

test("a non-rendering tick leaves the latches unchanged", () => {
	const out = composeCharacter(base({ config: { enabled: false } }));
	expect(out.nextState).toEqual({ pressureFired: [], milestones: [] });
});
