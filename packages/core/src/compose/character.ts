// The character's voice: the pack-owned personality line. Selection walks a fixed priority chain and returns the
// first slot that has content; empty slots fall through the chain to the idle slot, so when [comments].enabled is
// true and the pack ships voice a line essentially always renders. Pure: the only time input is the injected
// clock; the deterministic pick is a sha1 of the joined seed parts, so the same situation yields the same line
// rather than flickering every render.

import { createHash } from "node:crypto";

import {
	CHAR_LINE_MAX,
	EGG_EVERY_N,
	IDLE_ROTATE_MS,
	PRESSURE_MOODS,
	type CharacterComment,
	type Event,
	type EventCategory,
	type GreetingBucket,
	type MilestoneType,
	type PackJson,
	type PositiveGitMoment,
	type PressureMood,
	type ReactionCategory,
	type RenderMood,
	type Session,
	type Stack,
	type Tier,
} from "../domain";
import { displayWidth } from "../render";
import type { Clock, SessionState } from "../sources";

/** The four relationship milestones, in their fixed firing precedence. */
export interface PendingMilestones {
	readonly tier_up: boolean;
	readonly comeback: boolean;
	readonly streak: boolean;
	readonly anniversary: boolean;
}

/** Everything one character-selection tick needs. Pure data; no I/O, no env. */
export interface CharacterInputs {
	/** The loaded pack (only its voice fields are read). */
	readonly pack: Pick<PackJson, "lines" | "tone">;
	/** The character mood actually rendered this tick (base or synthetic pressure mood). */
	readonly mood: RenderMood;
	/** The freshest classified event still inside MOOD_WINDOW_MS (caller applies the window + tiebreak). */
	readonly freshEvent: Event | null;
	/** The project stack (most-specific signal), folded into the seed; null when unknown. */
	readonly stack: Stack | null;
	/** A positive git moment computed by the caller from GitState transitions (celebrating *with* you). */
	readonly positiveGit?: PositiveGitMoment;
	/** Familiarity tier for this character. */
	readonly tier: Tier;
	/** True when this project has no prior session for any character (first contact). */
	readonly firstContact: boolean;
	/** Pending relationship milestones (idle only, once per session). */
	readonly pending: PendingMilestones;
	/** The per-session render latches read here. */
	readonly state: Pick<SessionState, "pressureFired" | "milestones">;
	readonly clock: Clock;
	readonly session: Session;
	/** The [comments] config subset. */
	readonly config: { readonly enabled: boolean };
}

export interface CharacterResult {
	readonly comment: CharacterComment | null;
	readonly nextState: Pick<SessionState, "pressureFired" | "milestones">;
}

interface Slot {
	readonly pool: readonly string[];
	/** A once-per-session latch applied only on a tick the slot actually renders. */
	readonly latch?: { readonly kind: "pressure" | "milestone"; readonly value: string };
}

const sha1Int = (s: string): number => createHash("sha1").update(s).digest().readUInt32BE(0);

const pickLine = (pool: readonly string[], seedNum: number): string =>
	pool.length === 0 ? "" : (pool[seedNum % pool.length] ?? "");

/** Hard-slice an over-long line to CHAR_LINE_MAX (65 columns + a trailing ellipsis = exactly 66). */
const capColumns = (s: string, max: number): string => {
	if (displayWidth(s) <= max) return s;
	let out = "";
	let w = 0;
	for (const ch of s) {
		const cw = displayWidth(ch);
		if (w + cw > max - 1) break;
		out += ch;
		w += cw;
	}
	return `${out}…`;
};

const isPressureMood = (m: RenderMood): m is PressureMood =>
	(PRESSURE_MOODS as readonly string[]).includes(m);

/** Map a classified event category to the pack's 18-cell reaction key, or null (no reaction cell). */
const reactionCell = (category: EventCategory): ReactionCategory | null => {
	switch (category) {
		case "test_fail":
		case "build_fail":
		case "typecheck_fail":
		case "lint":
		case "format":
		case "install":
		case "file_edit":
		case "search":
		case "web_fetch":
		case "todo_update":
		case "agent_spawn":
		case "skill_run":
		case "docker":
		case "k8s":
		case "deploy":
		case "db_migrate":
		case "dangerous":
			return category;
		case "git_commit":
		case "git_push":
		case "git_pull":
		case "git_merge":
		case "git_rebase":
		case "git_branch":
		case "git_tag":
		case "git_stash":
		case "force_push":
			return "git";
		case "test_pass":
		case "build_pass":
		case "typecheck_pass":
		case "file_read":
		case "server_start":
			return null;
	}
};

const MILESTONE_ORDER: readonly MilestoneType[] = ["tier_up", "comeback", "streak", "anniversary"];

/** The highest-precedence pending milestone not yet latched this session, or null. */
const pendingMilestone = (input: CharacterInputs): MilestoneType | null => {
	for (const m of MILESTONE_ORDER) {
		if (input.pending[m] && !input.state.milestones.includes(m)) return m;
	}
	return null;
};

interface ClockParts {
	readonly hour: number;
	readonly minute: number;
	readonly weekday: number;
	readonly month: number;
	readonly day: number;
}

const WEEKDAYS: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

const clockParts = (clock: Clock): ClockParts => {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: clock.timezone(),
		hourCycle: "h23",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		month: "2-digit",
		day: "2-digit",
	});
	const parts = fmt.formatToParts(new Date(clock.now()));
	const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
	return {
		hour: Number(get("hour")),
		minute: Number(get("minute")),
		weekday: WEEKDAYS[get("weekday")] ?? 0,
		month: Number(get("month")),
		day: Number(get("day")),
	};
};

/** The greeting's time-of-day bucket; weekend overrides the hour buckets. */
const greetingBucket = (clock: Clock): GreetingBucket => {
	const { hour, weekday } = clockParts(clock);
	if (weekday === 0 || weekday === 6) return "weekend";
	if (hour >= 5 && hour < 12) return "morning";
	if (hour >= 12 && hour < 17) return "day";
	if (hour >= 17 && hour < 21) return "evening";
	return "night";
};

/** A date/clock surprise: new year's day, or the top of an hour. */
const isDateSurprise = (clock: Clock): boolean => {
	const { month, day, minute } = clockParts(clock);
	return (month === 1 && day === 1) || minute === 0;
};

const makeSeed = (input: CharacterInputs, bucket: GreetingBucket): string => {
	const eventId =
		input.positiveGit !== undefined ? `git:${input.positiveGit}`
		: input.freshEvent !== null ? input.freshEvent.category
		: "";
	const fileClass = input.stack ?? "";
	const rotation = Math.floor(input.clock.now() / IDLE_ROTATE_MS);
	return [input.session, input.mood, eventId, fileClass, bucket, input.tier, rotation].join("|");
};

/** The low idle slot: dateEgg → egg → greeting → idle fallback. Null only when the pack ships no idle voice. */
const lowIdleSlot = (input: CharacterInputs, seed: string, bucket: GreetingBucket): Slot | null => {
	const { lines } = input.pack;
	const { tier } = input;
	if (isDateSurprise(input.clock) && lines.dateEgg.length > 0) return { pool: lines.dateEgg };
	if (sha1Int(`${seed}|egg`) % EGG_EVERY_N === 0) {
		const egg = lines.egg[tier];
		if (egg.length > 0) return { pool: egg };
	}
	const greet = lines.greeting[bucket][tier];
	if (greet.length > 0) return { pool: greet };
	const idle = lines.mood.idle[tier];
	return idle.length > 0 ? { pool: idle } : null;
};

/** Event reaction — positive git moments (tier-nested) then the flat reaction cells. Null when neither has content. */
const eventSlot = (input: CharacterInputs): Slot | null => {
	const { lines } = input.pack;
	const { tier } = input;
	if (input.positiveGit !== undefined) {
		const pool = lines.positiveGit[input.positiveGit][tier];
		if (pool.length > 0) return { pool };
	}
	if (input.freshEvent !== null) {
		const cell = reactionCell(input.freshEvent.category);
		if (cell !== null) {
			const pool = lines.event[cell];
			if (pool.length > 0) return { pool };
		}
	}
	return null;
};

/**
 * Mood slot for a pressure or non-idle base mood (non-idle tier-nested; pressure flat, latched once per session).
 * Always resolves — its own pool when non-empty, otherwise the low idle slot so a line still renders.
 */
const moodSlot = (input: CharacterInputs, seed: string, bucket: GreetingBucket): Slot | null => {
	const { lines } = input.pack;
	const { tier, mood } = input;
	if (isPressureMood(mood)) {
		if (!input.state.pressureFired.includes(mood)) {
			const pool = lines.pressure[mood];
			if (pool.length > 0) {
				return { pool, latch: { kind: "pressure", value: mood } };
			}
		}
		// already fired or empty — fall through to the idle slot so a line still renders.
		return lowIdleSlot(input, seed, bucket);
	}
	const pool = lines.mood[mood][tier];
	if (pool.length > 0) return { pool };
	return lowIdleSlot(input, seed, bucket);
};

/** Walk the priority chain and return the first slot that has content; empty slots fall through to the idle slot. */
const resolveSlot = (input: CharacterInputs, seed: string, bucket: GreetingBucket): Slot | null => {
	const { lines } = input.pack;
	const { tier, mood } = input;

	// 1. First contact.
	if (input.firstContact) {
		const pool = lines.firstContact[tier];
		if (pool.length > 0) return { pool };
	}

	// 2. Event reaction.
	const event = eventSlot(input);
	if (event !== null) return event;

	// 3. Mood (pressure and non-idle base moods; idle falls through to the milestone/idle path).
	if (isPressureMood(mood) || mood !== "idle") return moodSlot(input, seed, bucket);

	// idle mood: 4. milestone (idle only), then the low idle slot.
	const milestone = pendingMilestone(input);
	if (milestone !== null) {
		const pool = lines.milestone[milestone][tier];
		if (pool.length > 0) {
			return { pool, latch: { kind: "milestone", value: milestone } };
		}
	}
	return lowIdleSlot(input, seed, bucket);
};

const applyLatch = (
	state: Pick<SessionState, "pressureFired" | "milestones">,
	latch: Slot["latch"],
): Pick<SessionState, "pressureFired" | "milestones"> => {
	const pressureFired = [...state.pressureFired];
	const milestones = [...state.milestones];
	if (latch?.kind === "pressure" && !pressureFired.includes(latch.value)) {
		pressureFired.push(latch.value);
	}
	if (latch?.kind === "milestone" && !milestones.includes(latch.value)) {
		milestones.push(latch.value);
	}
	return { pressureFired, milestones };
};

/**
 * Select the character's voice line for this tick. Returns `comment: null` (the comment row is then omitted) only
 * when comments are disabled or the pack ships no usable voice for any slot; otherwise a line always renders.
 * `nextState` carries the once-per-session pressure/milestone latches, which advance only on a tick the line
 * actually renders.
 */
export const composeCharacter = (input: CharacterInputs): CharacterResult => {
	const base: Pick<SessionState, "pressureFired" | "milestones"> = {
		pressureFired: [...input.state.pressureFired],
		milestones: [...input.state.milestones],
	};
	if (!input.config.enabled) return { comment: null, nextState: base };

	const bucket = greetingBucket(input.clock);
	const seed = makeSeed(input, bucket);
	const slot = resolveSlot(input, seed, bucket);
	if (slot === null) return { comment: null, nextState: base };

	const seedNum = sha1Int(seed);
	const text = capColumns(pickLine(slot.pool, seedNum), CHAR_LINE_MAX);
	return { comment: { text }, nextState: applyLatch(input.state, slot.latch) };
};
